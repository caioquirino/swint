import { ulid } from 'ulid';

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export type IdGenerator = () => string;

export const ulidIds: IdGenerator = () => ulid();
