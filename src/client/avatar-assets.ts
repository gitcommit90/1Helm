import { authenticatedAssetSrc as mobileAuthenticatedAssetSrc } from "./mobile.ts";

export const authenticatedAssetSrc = (source: string): string => mobileAuthenticatedAssetSrc(source);
