import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const DEFAULT_RECORDINGS_DIR = path.resolve(process.cwd(), 'recordings');

function buildGridDimensions(trackCount: number) {
  const columns = Math.ceil(Math.sqrt(trackCount));
  const rows = Math.ceil(trackCount / columns);
  return { columns, rows };
}

export async function getRecordingFiles(roomId: string): Promise<string[]> {
  const roomDir = path.join(DEFAULT_RECORDINGS_DIR, roomId);
  await fs.mkdir(roomDir, { recursive: true });
  const files = await fs.readdir(roomDir).catch(() => []);
  return files
    .filter((file) => file.endsWith('.webm') && file !== 'final.webm')
    .map((file) => path.join(roomDir, file));
}

export async function mergeRecordings(roomId: string): Promise<{ outputPath: string; skipped: string[] }> {
  const tracks = await getRecordingFiles(roomId);
  const outputPath = path.join(DEFAULT_RECORDINGS_DIR, roomId, 'final.mp4');

  if (tracks.length === 0) {
    throw new Error('No recordings available to merge');
  }

  if (tracks.length === 1) {
    await copySingleTrack(tracks[0], outputPath);
    return { outputPath, skipped: [] };
  }

  const { columns } = buildGridDimensions(tracks.length);
  const scaledStreams = tracks.map((_, index) => `[${index}:v]setpts=PTS-STARTPTS,scale=1280:720[v${index}]`).join(';');
  const audioStreams = tracks.map((_, index) => `[${index}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a${index}]`).join(';');
  const layouts = tracks.map((_, index) => `${(index % columns) * 1280}_${Math.floor(index / columns) * 720}`).join('|');
  const stackInputs = tracks.map((_, index) => `[v${index}]`).join('');
  const mixInputs = tracks.map((_, index) => `[a${index}]`).join('');
  const filterComplex = `${scaledStreams};${audioStreams};${stackInputs}xstack=inputs=${tracks.length}:layout=${layouts}:fill=black[vout];${mixInputs}amix=inputs=${tracks.length}:dropout_transition=2[aout]`;

  const ffmpegArgs = [
    '-y',
    ...tracks.flatMap((track) => ['-i', track]),
    '-filter_complex',
    filterComplex,
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '18',
    '-c:a',
    'aac',
    outputPath,
  ];

  await runFfmpeg(ffmpegArgs);
  return { outputPath, skipped: [] };
}

async function copySingleTrack(inputPath: string, outputPath: string): Promise<void> {
  const ffmpegArgs = ['-y', '-i', inputPath, '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac', outputPath];
  await runFfmpeg(ffmpegArgs);
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    ffmpeg.on('error', (error) => reject(new Error(`Failed to start ffmpeg: ${error.message}`)));
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });
}
