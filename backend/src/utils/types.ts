import z, { object } from "zod";

const CreateMessageSchema = z.object({
  roomName: z.string().min(1),
  content: z.string().min(1).max(5000),
});

const GetMessagesSchema = z.object({
  roomName: z.string().min(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
  cursor: z.string().optional(),
});

const EditMessageSchema = z.object({
  content: z.string().min(1).max(5000),
});

const MessageParamsSchema = z.object({
  roomName: z.string().min(1),
  messageId: z.string().min(1),
});

const TrackEventSchema = z.object({
  eventType: z.enum([
    "page_view",
    "room_join",
    "room_leave",
    "message_sent",
    "video_enabled",
    "video_disabled",
    "audio_enabled",
    "audio_disabled",
    "screen_share_started",
    "screen_share_stopped",
    "recording_started",
    "recording_stopped",
  ]),
  roomName: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  browserInfo: z.record(z.string(), z.unknown()).optional(),
  sessionId: z.string(),
});

const BatchEventSchema = z.object({
  events: z.array(
    z.object({
      eventType: z.enum([
        "page_view",
        "room_join",
        "room_leave",
        "message_sent",
        "video_enabled",
        "video_disabled",
        "audio_enabled",
        "audio_disabled",
        "screen_share_started",
        "screen_share_stopped",
        "recording_started",
        "recording_stopped",
      ]),
      timestamp: z.string().optional(),
      roomName: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      browserInfo: z.record(z.string(), z.unknown()).optional(),
      sessionId: z.string(),
      retryCount: z.number().optional().default(0),
    })
  ),
});

const GetTokenSchema = z.object({
  roomName: z.string().min(1),
  participantName: z.string().min(1),
});

// Export schemas
export {
  CreateMessageSchema,
  GetMessagesSchema,
  EditMessageSchema,
  MessageParamsSchema,
  TrackEventSchema,
  BatchEventSchema,
  GetTokenSchema
};

// Export TypeScript types inferred from schemas
export type CreateMessageInput = z.infer<typeof CreateMessageSchema>;
export type GetMessagesInput = z.infer<typeof GetMessagesSchema>;
export type EditMessageInput = z.infer<typeof EditMessageSchema>;
export type MessageParamsInput = z.infer<typeof MessageParamsSchema>;
export type TrackEventInput = z.infer<typeof TrackEventSchema>;
export type BatchEventInput = z.infer<typeof BatchEventSchema>;
export type GetTokenInput = z.infer<typeof GetTokenSchema>;

// Export event type enum for type safety
export type EventType = 
  | "page_view"
  | "room_join"
  | "room_leave"
  | "message_sent"
  | "video_enabled"
  | "video_disabled"
  | "audio_enabled"
  | "audio_disabled"
  | "screen_share_started"
  | "screen_share_stopped"
  | "recording_started"
  | "recording_stopped";

// Export batch event item type
export type BatchEventItem = z.infer<typeof BatchEventSchema>["events"][number];
