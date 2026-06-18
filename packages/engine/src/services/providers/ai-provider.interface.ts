export interface AiProvider {
  readonly name: string;
  generate(prompt: string, model: string, apiKey: string): Promise<Response>;
}
