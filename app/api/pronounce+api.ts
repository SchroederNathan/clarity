import { gateway, generateSpeech } from "ai";
import { z } from "zod";

const requestSchema = z
  .object({ word: z.string().trim().min(1).max(40) })
  .strict();

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: "Invalid word." }, { status: 400 });
  }

  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    return Response.json(
      { error: "Pronunciation audio has not been configured yet." },
      { status: 503 },
    );
  }

  try {
    const { audio } = await generateSpeech({
      model: gateway.speech(process.env.AI_TTS_MODEL || "openai/tts-1"),
      text: parsed.data.word,
      voice: "alloy",
      outputFormat: "mp3",
      // A touch under normal speed so the word is easy to imitate.
      speed: 0.9,
      maxRetries: 2,
    });

    return new Response(audio.uint8Array as unknown as BodyInit, {
      headers: {
        "Content-Type": audio.mediaType || "audio/mpeg",
        // The same word always yields an equivalent clip; let clients cache it.
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    console.error(
      "[pronounce] TTS generation failed:",
      error instanceof Error ? error.message : error,
    );
    return Response.json(
      { error: "Pronunciation audio is unavailable right now. Please try again." },
      { status: 502 },
    );
  }
}
