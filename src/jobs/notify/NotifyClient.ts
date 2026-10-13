import NotifyClientInterface from "./NotifyClientInterface";
import DiscordBotClient from "./clients/DiscordBotClient";

type ClientArgs = Record<string, string>;

const clientFactories: Record<
  string,
  (args: ClientArgs) => NotifyClientInterface
> = {
  "discord-bot": ({ webhookUrl }) => new DiscordBotClient(webhookUrl),
};

export default class NotifyClient implements NotifyClientInterface {
  private readonly client: NotifyClientInterface;

  constructor(clientName: string, args: ClientArgs = {}) {
    const createClient = clientFactories[clientName];
    if (!createClient) {
      throw new Error(`Notification client '${clientName}' is not implemented`);
    }
    this.client = createClient(args);
  }

  notify(message: string): Promise<void> {
    return this.client.notify(message);
  }

  alert(message: string): Promise<void> {
    return this.client.alert(message);
  }
}
