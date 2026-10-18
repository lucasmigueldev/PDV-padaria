import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../lib/supabaseClient'

const STORAGE_KEY_GLOBAL = 'pdv_pix_key_global'
const LEGACY_STORAGE_KEY = 'pdv_pix_key'
const STORAGE_KEY_PREFIX = 'pdv_pix_key_bakery_'

const SETTING_KEY_GLOBAL = 'pix_key'

const DEFAULT_KEY = ''

function storageKeyForBakery(bakeryId: string): string {
  return `${STORAGE_KEY_PREFIX}${bakeryId}`
}

function settingKeyForBakery(bakeryId: string): string {
  return `pix_key_bakery_${bakeryId}`
}

let cachedKey: string | null = null

export function getPixKeySync(bakeryId?: string | null): string {
  // 1. Chave específica da unidade do operador (quando houver bakeryId)
  if (bakeryId) {
    try {
      const stored = localStorage.getItem(storageKeyForBakery(bakeryId))
      if (stored?.trim()) {
        cachedKey = stored.trim()
        return cachedKey
      }
    } catch {
      // localStorage indisponível
    }
  }

  // 2. Chave global (todas as unidades)
  try {
    const stored = localStorage.getItem(STORAGE_KEY_GLOBAL)
    if (stored?.trim()) {
      cachedKey = stored.trim()
      return cachedKey
    }
    // Compatibilidade com chave antiga salva sem sufixo de unidade
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy?.trim()) {
      cachedKey = legacy.trim()
      return cachedKey
    }
  } catch {
    // localStorage indisponível
  }

  return DEFAULT_KEY
}

export async function fetchPixKey(bakeryId?: string | null): Promise<string> {
  // Tenta primeiro a chave específica da unidade do operador
  if (bakeryId) {
    try {
      const { data, error } = await getSupabaseClient()
        .from('app_settings')
        .select('value')
        .eq('key', settingKeyForBakery(bakeryId))
        .maybeSingle()

      if (!error && data?.value?.trim()) {
        const key = data.value.trim()
        try {
          localStorage.setItem(storageKeyForBakery(bakeryId), key)
        } catch {
          // ignorar erro de storage
        }
        cachedKey = key
        return key
      }
    } catch {
      // tabela pode não existir ainda; segue para fallback abaixo
    }
  }

  // Tenta a chave global (todas as unidades)
  try {
    const { data, error } = await getSupabaseClient()
      .from('app_settings')
      .select('value')
      .eq('key', SETTING_KEY_GLOBAL)
      .maybeSingle()

    if (!error && data?.value?.trim()) {
      const key = data.value.trim()
      cachedKey = key
      try {
        localStorage.setItem(STORAGE_KEY_GLOBAL, key)
      } catch {
        // ignorar erro de storage
      }
      return key
    }
  } catch {
    // se a tabela app_settings não existir ainda no Supabase, cai graciosamente para localStorage
  }

  return getPixKeySync(bakeryId)
}

export async function savePixKey(key: string, bakeryId?: string | null): Promise<string> {
  const trimmed = key.trim()
  const keyToSave = trimmed

  try {
    if (bakeryId) {
      localStorage.setItem(storageKeyForBakery(bakeryId), keyToSave)
    } else {
      localStorage.setItem(STORAGE_KEY_GLOBAL, keyToSave)
    }
  } catch {
    // ignorar erro de storage
  }

  // Tenta persistir no Supabase se possível
  try {
    await getSupabaseClient()
      .from('app_settings')
      .upsert(
        { key: bakeryId ? settingKeyForBakery(bakeryId) : SETTING_KEY_GLOBAL, value: keyToSave },
        { onConflict: 'key' }
      )
  } catch {
    // fallback suave mantido em localStorage
  }

  // Dispara evento para atualizar componentes que estejam ouvindo
  window.dispatchEvent(new CustomEvent('pix-key-changed', { detail: keyToSave }))

  return keyToSave
}

export async function deletePixKey(bakeryId?: string | null): Promise<void> {
  try {
    if (bakeryId) {
      localStorage.removeItem(storageKeyForBakery(bakeryId))
    } else {
      localStorage.removeItem(STORAGE_KEY_GLOBAL)
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    }
  } catch {
    // ignorar erro de storage
  }

  try {
    await getSupabaseClient()
      .from('app_settings')
      .delete()
      .eq('key', bakeryId ? settingKeyForBakery(bakeryId) : SETTING_KEY_GLOBAL)
  } catch {
    // fallback suave mantido em localStorage
  }

  // Dispara evento para atualizar componentes que estejam ouvindo
  window.dispatchEvent(new CustomEvent('pix-key-changed', { detail: '' }))
}

export function usePixKey(bakeryId?: string | null) {
  const [pixKey, setPixKey] = useState<string>(() => getPixKeySync(bakeryId))

  useEffect(() => {
    let isMounted = true

    void fetchPixKey(bakeryId).then((key) => {
      if (isMounted) setPixKey(key)
    })

    function handleKeyChange(event: Event) {
      const customEvent = event as CustomEvent<string>
      if (customEvent.detail !== undefined) {
        setPixKey(() => getPixKeySync(bakeryId))
      }
    }

    window.addEventListener('pix-key-changed', handleKeyChange)
    window.addEventListener('storage', (event) => {
      const relevantKey = bakeryId ? storageKeyForBakery(bakeryId) : STORAGE_KEY_GLOBAL
      if (event.key === relevantKey || event.key === LEGACY_STORAGE_KEY) {
        cachedKey = event.newValue ?? null
        setPixKey(event.newValue ?? '')
      }
    })

    return () => {
      isMounted = false
      window.removeEventListener('pix-key-changed', handleKeyChange)
    }
  }, [bakeryId])

  return pixKey
}
