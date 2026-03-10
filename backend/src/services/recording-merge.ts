import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { execSync } from 'child_process';

// Configure FFmpeg path
try {
  const ffmpegPath = process.env.FFMPEG_PATH || (process.platform === 'win32' ? 'ffmpeg' : '');
  if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
  } else {
    // Linux/macOS: Try to find FFmpeg in PATH
    execSync('which ffmpeg');
  }
} catch (error) {
  console.error('FFmpeg not found. Please install FFmpeg and ensure it is in PATH or set FFMPEG_PATH environment variable.');
  throw new Error('FFmpeg is required for recording merge functionality');
}

export interface TrackInfo {
  participantId: string;
  path: string;           // local path to assembled .webm file
  startOffset: number;    // ms since recording started — used for sync padding
}

// Helper to build grid filter based on track count
function buildGridFilter(count: number): { video: string | null; audio: string | null } {
  const cappedCount = Math.min(count, 16); // Cap at 4x4 grid

  if (cappedCount === 1) {
    return { video: null, audio: null }; // Passthrough for single track
  }

  // Determine grid dimensions
  let cols, rows;
  if (cappedCount === 2) {
    cols = 2; rows = 1;
  } else if (cappedCount <= 4) {
    cols = 2; rows = 2;
  } else if (cappedCount <= 9) {
    cols = 3; rows = 3;
  } else {
    cols = 4; rows = 4;
  }

  // Build xstack layout string
  let layout = '';
  for (let i = 0; i < cappedCount; i++) {
    const x = (i % cols) * 1280; // 1280px per cell width
    const y = Math.floor(i / cols) * 720; // 720px per cell height
    layout += `${x}_${y}|`;
  }
  layout = layout.slice(0, -1); // Remove trailing |

  // Build video and audio filters
  const videoInputs = Array.from({ length: cappedCount }, (_, i) => `[${i}:v]`).join('');
  const audioInputs = Array.from({ length: cappedCount }, (_, i) => `[${i}:a]`).join('');

  const videoFilter = `${videoInputs}xstack=inputs=${cappedCount}:layout=${layout}[v]`;
  const audioFilter = `${audioInputs}amix=inputs=${cappedCount}[a]`;

  return { video: videoFilter, audio: audioFilter };
}

// Helper to create silent black video for sync padding
function createSilentVideo(durationMs: number, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input('anullsrc')
      .inputFormat('lavfi')
      .input(`color=c=black:s=1280x720:r=30:d=${durationMs / 1000}`)
      .inputFormat('lavfi')
      .output(outputPath)
      .videoCodec('libvpx')
      .audioCodec('libvorbis')
      .duration(durationMs / 1000)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

// Helper to concatenate two video files
function concatenateVideos(file1: string, file2: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const listPath = path.join(path.dirname(outputPath), 'concat.txt');
    fs.writeFileSync(listPath, `file '${file1}'\nfile '${file2}'`);
    
    ffmpeg()
      .input(listPath)
      .inputFormat('concat')
      .inputOptions('-safe 0')
      .output(outputPath)
      .videoCodec('copy')
      .audioCodec('copy')
      .on('end', () => {
        fs.unlinkSync(listPath);
        resolve();
      })
      .on('error', reject)
      .run();
  });
}

export async function mergeRecordings(
  roomId: string,
  sessionId: string,
  tracks: TrackInfo[]
): Promise<string> {
  // Validate track paths to prevent FFmpeg command injection
  for (const track of tracks) {
    const trackPathRegex = /^[a-zA-Z0-9_./-]+$/;
    if (!trackPathRegex.test(track.path)) {
      throw new Error(`Invalid track path: ${track.path}`);
    }
  }

  const RECORDINGS_DIR = process.env.RECORDINGS_DIR || 'recordings';
  const outputDir = path.join(RECORDINGS_DIR, roomId, sessionId);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'final.mp4');

  // Process each track to add sync padding if needed
  const processedTracks: TrackInfo[] = [];
  for (const track of tracks) {
    if (track.startOffset > 0) {
      const paddingPath = path.join(outputDir, `padding_${track.participantId}.webm`);
      const paddedPath = path.join(outputDir, `padded_${track.participantId}.webm`);
      
      await createSilentVideo(track.startOffset, paddingPath);
      await concatenateVideos(paddingPath, track.path, paddedPath);
      
      processedTracks.push({ ...track, path: paddedPath });
      
      // Clean up temporary files
      fs.unlinkSync(paddingPath);
    } else {
      processedTracks.push(track);
    }
  }

  // Build FFmpeg command
  return new Promise((resolve, reject) => {
    let command = ffmpeg();

    // Add inputs
    processedTracks.forEach(track => {
      command = command.input(track.path);
    });

    const filters = buildGridFilter(processedTracks.length);

    // Apply filters if needed
    if (filters.video && filters.audio) {
      command = command
        .complexFilter([filters.video, filters.audio])
        .outputOptions(['-map [v]', '-map [a]']);
    }

    // Output settings
    command = command
      .output(outputPath)
      .videoCodec('libx264')
      .outputOptions(['-preset fast', '-crf 22'])
      .audioCodec('aac')
      .outputOptions(['-b:a 192k', '-movflags +faststart'])
      .on('end', () => {
        // Clean up temporary padded files
        processedTracks.forEach(track => {
          if (track.path.includes('padded_')) {
            fs.unlinkSync(track.path);
          }
        });
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('FFmpeg merge error:', err);
        // Cleanup temporary files on error
        processedTracks.forEach(track => {
          if (track.path.includes('padded_')) {
            try {
              fs.unlinkSync(track.path);
            } catch (e) {
              console.error('Failed to delete temporary file:', track.path, e);
            }
          }
        });
        reject(err);
      });

    command.run();
  });
}
