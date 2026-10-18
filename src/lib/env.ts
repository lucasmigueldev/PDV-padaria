import type { Env } from '../types/Env'

export function getEnv(): Env {
  return {
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL?.trim(),
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim(),
  }
}