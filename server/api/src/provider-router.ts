import { ProviderError, type GenerationProvider } from "./provider.js";

export class ProviderRouter {
  constructor(private readonly providers: Map<string, GenerationProvider>) {}

  for(providerId: string) {
    const provider = this.providers.get(providerId);
    if (!provider)
      throw new ProviderError(
        "PROVIDER_NOT_CONFIGURED",
        "所选模型渠道尚未配置",
        false,
        { providerId },
      );
    return provider;
  }
}
