import { AuthContext } from "../middleware/auth-wa.js";
import { isGreeting, handleGreeting } from "./greeting.js";
import { isHelp, handleHelp } from "./help.js";
import { isManualCommand, handleManual } from "./manual-mode.js";
import { isStartCommand, handleStart } from "./start.js";
import { isSpkCommand, isBatalCommand, handleSpkCommand, handleSpkBatal, handleSpkFlow } from "./spk.js";
import { isLengkapiCommand, handleLengkapiCommand, handleLengkapiBatal, handleLengkapiFlow } from "./lengkapi.js";
import { isSetoranCommand, isTfCommand, handleSetoranCommand, handleTfCommand, handleSetoranBatal, handleSetoranFlow } from "./setoran.js";
import { handleIncomingMedia, handlePendingMediaChoice } from "./media-ocr.js";
import { getConvState } from "../services/conv-state.js";
import { isBotOff } from "../services/session-mode.js";
import { logger } from "../services/logger.js";
import { logMessage } from "../utils/message-log.js";
import { evolution } from "../services/evolution.js";

export async function route(ctx: AuthContext): Promise<void> {
  const start = Date.now();
  const text = ctx.msg.text.trim();

  if (ctx.msg.fromMe) return;
  if (ctx.msg.isGroup) return;

  let intent = "unknown";
  let handlerName = "none";
  let status = "ignored";

  try {
    if (!ctx.isAuthorized) {
      intent = "unauthorized";
      status = "silent";
      logger.info({ from: ctx.msg.fromNumber, text: text.slice(0, 50) }, "Non-karyawan, silent");
      return;
    }

    if (isStartCommand(text)) {
      intent = "start";
      handlerName = "handleStart";
      await handleStart(ctx);
      status = "success";
      return;
    }

    if (await isBotOff(ctx.msg.fromNumber)) {
      intent = "bot_off";
      status = "muted";
      return;
    }

    await evolution.markRead(ctx.msg.fromJid, ctx.msg.messageId);

    if (isManualCommand(text)) {
      intent = "manual";
      handlerName = "handleManual";
      await handleManual(ctx);
      status = "success";
      return;
    }

    // /batal cancels whichever flow is active
    if (isBatalCommand(text)) {
      intent = "batal";
      const spkOk = await handleSpkBatal(ctx);
      if (spkOk) { handlerName = "handleSpkBatal"; status = "success"; return; }
      const lengkapiOk = await handleLengkapiBatal(ctx);
      if (lengkapiOk) { handlerName = "handleLengkapiBatal"; status = "success"; return; }
      const setoranOk = await handleSetoranBatal(ctx);
      if (setoranOk) { handlerName = "handleSetoranBatal"; status = "success"; return; }
      handlerName = "batal_noop";
      await evolution.sendText(ctx.msg.fromNumber, "Tidak ada proses yang sedang berjalan.", { delayMs: 300 });
      status = "success";
      return;
    }

    // /lengkapi before /spk so it doesn't collide with spk flow
    if (isLengkapiCommand(text)) {
      intent = "lengkapi_start";
      handlerName = "handleLengkapiCommand";
      await handleLengkapiCommand(ctx);
      status = "success";
      return;
    }

    if (isSetoranCommand(text)) {
      intent = "setoran_start";
      handlerName = "handleSetoranCommand";
      await handleSetoranCommand(ctx);
      status = "success";
      return;
    }

    if (isTfCommand(text)) {
      intent = "tf_start";
      handlerName = "handleTfCommand";
      await handleTfCommand(ctx);
      status = "success";
      return;
    }

    if (isSpkCommand(text)) {
      intent = "spk_start";
      handlerName = "handleSpkCommand";
      await handleSpkCommand(ctx);
      status = "success";
      return;
    }

    // Active flow takes priority over generic media/text routing
    const convState = await getConvState(ctx.msg.fromNumber);

    if (convState?.flow === "spk") {
      const handled = await handleSpkFlow(ctx);
      if (handled) {
        intent = `spk_${convState.step.toLowerCase()}`;
        handlerName = "handleSpkFlow";
        status = "success";
        return;
      }
    }

    if (convState?.flow === "lengkapi") {
      const handled = await handleLengkapiFlow(ctx);
      if (handled) {
        intent = `lengkapi_${convState.step.toLowerCase()}`;
        handlerName = "handleLengkapiFlow";
        status = "success";
        return;
      }
    }

    if (convState?.flow === "setoran") {
      const handled = await handleSetoranFlow(ctx);
      if (handled) {
        intent = `setoran_${convState.step.toLowerCase()}`;
        handlerName = "handleSetoranFlow";
        status = "success";
        return;
      }
    }

    if (isHelp(text)) {
      intent = "help";
      handlerName = "handleHelp";
      await handleHelp(ctx);
      status = "success";
      return;
    }

    // Caption-based KTP/TF detection
    if (ctx.msg.type === "image" || ctx.msg.type === "document") {
      intent = "media";
      handlerName = "handleIncomingMedia";
      await handleIncomingMedia(ctx);
      status = "success";
      return;
    }

    // "ktp" / "tf" reply for pending media classification
    const pendingHandled = await handlePendingMediaChoice(ctx);
    if (pendingHandled) {
      intent = "media_choice";
      handlerName = "handlePendingMediaChoice";
      status = "success";
      return;
    }

    if (isGreeting(text)) {
      intent = "greeting";
      handlerName = "handleGreeting";
      await handleGreeting(ctx);
      status = "success";
      return;
    }

    intent = "unknown";
    handlerName = "fallback";
    await evolution.sendText(
      ctx.msg.fromNumber,
      `Maaf ${ctx.namaPanggilan}, saya belum paham.\nKetik /help untuk daftar perintah.`,
      { delayMs: 600 }
    );
    status = "fallback";
  } catch (err) {
    status = "error";
    logger.error(
      { err: (err as Error).message, stack: (err as Error).stack, from: ctx.msg.fromNumber },
      "Handler error"
    );
  } finally {
    await logMessage({
      karyawan_id: ctx.karyawan?.id ?? null,
      wa_number: ctx.msg.fromNumber,
      direction: "in",
      message_text: text.slice(0, 1000),
      message_type: ctx.msg.type,
      intent,
      handler: handlerName,
      response_time_ms: Date.now() - start,
      status,
    });
  }
}
