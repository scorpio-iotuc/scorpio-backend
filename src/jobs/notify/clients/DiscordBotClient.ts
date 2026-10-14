import NotifyClientInterface from "../NotifyClientInterface";

export default class DiscordBotClient implements NotifyClientInterface {
  constructor(private readonly webhookUrl: string) {
    if (!webhookUrl.trim()) {
      throw new Error(
        "The discord-bot client requires DISCORD_WEBHOOK_URL or webhookUrl",
      );
    }
  }

  notify(message: string): Promise<void> {
    return this.send(message);
  }

  alert(message: string): Promise<void> {
    return this.send(`(@here)🚨: ${message}`);
  }

  private async send(content: string): Promise<void> {
    if (!content.trim() || content.length > 2000) {
      throw new Error(
        "Discord messages must contain between 1 and 2000 characters",
      );
    }

    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // Avoid including request credentials or Discord's response body in errors.
      throw new Error(
        `Discord webhook notification failed (HTTP ${response.status})`,
      );
    }
  }
}
