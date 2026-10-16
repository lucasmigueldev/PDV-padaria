import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../lib/supabaseClient'

const STORAGE_KEY = 'pdv_pix_key'
const DEFAULT_KEY = ''

let cachedKey: string | null = null

export function getPixKeySync(): string {
  if (cachedKey !== null) return cachedKey
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored?.trim()) {
      cachedKey = stored.trim()
      return cachedKey
    }
  } catch {
    // localStorage indisponível
  }
  return DEFAULT_KEY
}

export async function fetchPixKey(): Promise<string> {
  try {
    const { data, error } = await getSupabaseClient()
      .from('app_settings')
      .select('value')
      .eq('key', 'pix_key')
      .maybeSingle()

    if (!error && data?.value?.trim()) {
      const key = data.value.trim()
      cachedKey = key
      try {
        localStorage.setItem(STORAGE_KEY, key)
      } catch {
        // ignorar erro de storage
      }
      return key
    }
  } catch {
    // se a tabela app_settings não existir ainda no Supabase, cai graciosamente para localStorage
  }

  return getPixKeySync()
}

export async function savePixKey(key: string): Promise<string> {
  const trimmed = key.trim()
  const keyToSave = trimmed
  cachedKey = keyToSave

  try {
    localStorage.setItem(STORAGE_KEY, keyToSave)
  } catch {
    // ignorar erro de storage
  }

  // Tenta persistir no Supabase se possível
  try {
    await getSupabaseClient()
      .from('app_settings')
      .upsert(
        { key: 'pix_key', value: keyToSave },
        { onConflict: 'key' }
      )
  } catch {
    // fallback suave mantido em localStorage
  }

  // Dispara evento para atualizar componentes que estejam ouvindo
  window.dispatchEvent(new CustomEvent('pix-key-changed', { detail: keyToSave }))

  return keyToSave
}

export function usePixKey() {
  const [pixKey, setPixKey] = useState<string>(getPixKeySync)

  useEffect(() => {
    let isMounted = true

    void fetchPixKey().then((key) => {
      if (isMounted) setPixKey(key)
    })

    function handleKeyChange(event: Event) {
      const customEvent = event as CustomEvent<string>
      if (customEvent.detail !== undefined) {
        setPixKey(customEvent.detail)
      }
    }

    window.addEventListener('pix-key-changed', handleKeyChange)
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY) {
        cachedKey = event.newValue ?? null
        setPixKey(event.newValue ?? '')
      }
    })

    return () => {
      isMounted = false
      window.removeEventListener('pix-key-changed', handleKeyChange)
    }
  }, [])

  return pixKey
}
