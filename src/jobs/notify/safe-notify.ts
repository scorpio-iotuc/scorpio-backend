import { Logger } from "../../lib/Logger";
import type NotifyClientInterface from "./NotifyClientInterface";

const logger = new Logger("SatelliteNotifications");

// Delivery must never change the outcome of a database job.
export async function safeNotify(
  client: NotifyClientInterface | undefined,
  level: "notify" | "alert",
  message: string,
): Promise<void> {
  if (!client) return;
  try {
    // Reserve space for the client's alert prefix.
    await client[level](
      message.length > 1900 ? `${message.slice(0, 1897)}...` : message,
    );
  } catch {
    // Transport errors can contain the secret webhook URL.
    logger.error("Discord notification delivery failed", { level });
  }
}
