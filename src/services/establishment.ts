import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../lib/supabaseClient'

const STORAGE_KEY = 'pdv_establishment_name'
const DEFAULT_NAME = 'Padaria PDV'

let cachedName: string | null = null

export function getEstablishmentNameSync(): string {
    if (cachedName !== null) return cachedName
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored?.trim()) {
            cachedName = stored.trim()
            return cachedName
        }
    } catch {
        // localStorage indisponível
    }
    return DEFAULT_NAME
}

export async function fetchEstablishmentName(): Promise<string> {
    // Tenta carregar do Supabase (tabela app_settings ou similar, com fallback transparente)
    try {
        const { data, error } = await getSupabaseClient()
            .from('app_settings')
            .select('value')
            .eq('key', 'establishment_name')
            .maybeSingle()

        if (!error && data?.value?.trim()) {
            const name = data.value.trim()
            cachedName = name
            try {
                localStorage.setItem(STORAGE_KEY, name)
            } catch {
                // ignorar erro de storage
            }
            return name
        }
    } catch {
        // se a tabela app_settings não existir ainda no Supabase, cai graciosamente para localStorage
    }

    return getEstablishmentNameSync()
}

export async function saveEstablishmentName(name: string): Promise<string> {
    const trimmed = name.trim()
    const nameToSave = trimmed || DEFAULT_NAME
    cachedName = nameToSave

    try {
        localStorage.setItem(STORAGE_KEY, nameToSave)
    } catch {
        // ignorar erro de storage
    }

    // Tenta persistir no Supabase se possível
    try {
        await getSupabaseClient()
            .from('app_settings')
            .upsert(
                { key: 'establishment_name', value: nameToSave },
                { onConflict: 'key' }
            )
    } catch {
        // fallback suave mantido em localStorage
    }

    // Dispara evento para atualizar componentes que estejam ouvindo
    window.dispatchEvent(new CustomEvent('establishment-name-changed', { detail: nameToSave }))

    return nameToSave
}

export function useEstablishmentName() {
    const [establishmentName, setEstablishmentName] = useState<string>(getEstablishmentNameSync)

    useEffect(() => {
        let isMounted = true

        void fetchEstablishmentName().then((name) => {
            if (isMounted) setEstablishmentName(name)
        })

        function handleNameChange(event: Event) {
            const customEvent = event as CustomEvent<string>
            if (customEvent.detail) {
                setEstablishmentName(customEvent.detail)
            }
        }

        window.addEventListener('establishment-name-changed', handleNameChange)
        window.addEventListener('storage', (event) => {
            if (event.key === STORAGE_KEY && event.newValue) {
                cachedName = event.newValue
                setEstablishmentName(event.newValue)
            }
        })

        return () => {
            isMounted = false
            window.removeEventListener('establishment-name-changed', handleNameChange)
        }
    }, [])

    return establishmentName
}
