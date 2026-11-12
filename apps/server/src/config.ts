import { z } from 'zod';

const EnvSchema = z
  .object({
    PROVIDER: z.enum(['mock', 'openai']).default('mock'),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_BASE_URL: z.url().default('https://api.openai.com/v1'),
    OPENAI_TRANSCRIBE_MODEL: z.string().min(1).default('gpt-4o-mini-transcribe'),
    OPENAI_TRANSLATE_MODEL: z.string().min(1).default('gpt-4o-mini'),
    OPENAI_TTS_MODEL: z.string().min(1).default('gpt-4o-mini-tts'),
    OPENAI_TTS_VOICE: z.string().min(1).default('alloy'),

    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    HOST: z.string().default('127.0.0.1'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_WINDOW: z.string().default('1 minute'),
    MAX_AUDIO_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(5 * 1024 * 1024),
    MAX_TTS_CHARS: z.coerce.number().int().positive().default(800),
    MAX_ROOMS: z.coerce.number().int().positive().default(100),
    ROOM_IDLE_MINUTES: z.coerce.number().positive().default(30),
    MAX_TALKS: z.coerce.number().int().positive().default(20),
    TALK_IDLE_MINUTES: z.coerce.number().positive().default(60),
    TALK_MAX_LISTENERS: z.coerce.number().int().positive().default(300),
    TALK_MAX_LANGUAGES: z.coerce.number().int().min(1).max(20).default(6),
    DAILY_BUDGET_USD: z.coerce.number().min(0).default(5),
    PRICE_TRANSCRIBE_PER_MINUTE: z.coerce.number().min(0).default(0.003),
    PRICE_TRANSLATE_INPUT_PER_MILLION_TOKENS: z.coerce.number().min(0).default(0.15),
    PRICE_TRANSLATE_OUTPUT_PER_MILLION_TOKENS: z.coerce.number().min(0).default(0.6),
    PRICE_TTS_PER_1K_CHARS: z.coerce.number().min(0).default(0.017),
    USAGE_FILE: z.string().optional(),
    ADMIN_TOKEN: z
      .string()
      .optional()
      .refine((t) => !t || t.length >= 24, 'ADMIN_TOKEN must be at least 24 characters'),
    MOCK_LATENCY_MS: z.coerce.number().int().min(0).max(10_000).default(0),
    CORS_ORIGIN: z.string().optional(),
  })
  .refine((env) => env.PROVIDER !== 'openai' || Boolean(env.OPENAI_API_KEY), {
    message: 'OPENAI_API_KEY is required when PROVIDER=openai',
    path: ['OPENAI_API_KEY'],
  });

export type Env = z.infer<typeof EnvSchema>;

export interface AppConfig {
  provider: Env['PROVIDER'];
  openai: {
    apiKey: string;
    baseUrl: string;
    transcribeModel: string;
    translateModel: string;
    ttsModel: string;
    ttsVoice: string;
  };
  port: number;
  host: string;
  logLevel: Env['LOG_LEVEL'];
  rateLimit: { max: number; timeWindow: string };
  maxAudioBytes: number;
  maxTtsChars: number;
  rooms: { maxRooms: number; idleMs: number };
  talks: { maxTalks: number; idleMs: number; maxListeners: number; maxLanguages: number };
  usage: {
    budgetUsd: number;
    prices: {
      transcribePerMinute: number;
      translateInputPerMillion: number;
      translateOutputPerMillion: number;
      synthesizePer1kChars: number;
    };
    file: string | undefined;
  };
  /** Enables /api/admin when set. */
  adminToken: string | undefined;
  /** Artificial delay for the mock provider, to make demos and tests feel realistic. */
  mockLatencyMs: number;
  corsOrigin: string | undefined;
  /** Directory of the built web client to serve, if present. */
  webDistDir: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, webDistDir?: string): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid server configuration:\n${details}`);
  }
  const e = parsed.data;
  return {
    provider: e.PROVIDER,
    openai: {
      apiKey: e.OPENAI_API_KEY ?? '',
      baseUrl: e.OPENAI_BASE_URL.replace(/\/$/, ''),
      transcribeModel: e.OPENAI_TRANSCRIBE_MODEL,
      translateModel: e.OPENAI_TRANSLATE_MODEL,
      ttsModel: e.OPENAI_TTS_MODEL,
      ttsVoice: e.OPENAI_TTS_VOICE,
    },
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    rateLimit: { max: e.RATE_LIMIT_MAX, timeWindow: e.RATE_LIMIT_WINDOW },
    maxAudioBytes: e.MAX_AUDIO_BYTES,
    maxTtsChars: e.MAX_TTS_CHARS,
    rooms: { maxRooms: e.MAX_ROOMS, idleMs: e.ROOM_IDLE_MINUTES * 60_000 },
    talks: {
      maxTalks: e.MAX_TALKS,
      idleMs: e.TALK_IDLE_MINUTES * 60_000,
      maxListeners: e.TALK_MAX_LISTENERS,
      maxLanguages: e.TALK_MAX_LANGUAGES,
    },
    usage: {
      budgetUsd: e.DAILY_BUDGET_USD,
      prices: {
        transcribePerMinute: e.PRICE_TRANSCRIBE_PER_MINUTE,
        translateInputPerMillion: e.PRICE_TRANSLATE_INPUT_PER_MILLION_TOKENS,
        translateOutputPerMillion: e.PRICE_TRANSLATE_OUTPUT_PER_MILLION_TOKENS,
        synthesizePer1kChars: e.PRICE_TTS_PER_1K_CHARS,
      },
      file: e.USAGE_FILE || undefined,
    },
    adminToken: e.ADMIN_TOKEN || undefined,
    mockLatencyMs: e.MOCK_LATENCY_MS,
    corsOrigin: e.CORS_ORIGIN || undefined,
    webDistDir,
  };
}
