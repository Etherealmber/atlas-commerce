import type { Hono } from 'hono';
import type { Env } from '../env';

export type AtlasApp = Hono<{ Bindings: Env }>;
