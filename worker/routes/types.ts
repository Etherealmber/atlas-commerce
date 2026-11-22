import type { Hono } from 'hono';
import type { Env } from '../env';

export type AtlasVariables = {
  bffSurface?: string;
  role?: string;
  user?: { username?: string; role?: string };
};

export type AtlasApp = Hono<{ Bindings: Env; Variables: AtlasVariables }>;
