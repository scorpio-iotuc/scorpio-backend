export default interface NotifyClientInterface {
  notify(message: string): Promise<void>;
  alert(message: string): Promise<void>;
}
