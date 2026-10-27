import { kw } from './kw';
import { kg } from './kg';
import { tx } from './tx';
import { wy } from './wy';
import { mg } from './mg';
import type { Platform, PlatformSdk } from './types';

export const sdks: Record<Platform, PlatformSdk> = { kw, kg, tx, wy, mg };
export const getSdk = (platform: Platform) => sdks[platform];
export * from './types';
