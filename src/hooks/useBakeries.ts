import { useEffect, useState } from 'react'

import { getBakeries } from '../services/bakeries'
import type { Bakery } from '../types/Bakery'
import { registerLegacyBakeryIds } from '../utils/legacyBakeryIds'

export function useBakeries() {
    const [bakeries, setBakeries] = useState<Bakery[]>([])
    const [isLoadingBakeries, setIsLoadingBakeries] = useState(true)
    const [bakeriesLoadError, setBakeriesLoadError] = useState('')

    useEffect(() => {
        let isActive = true

        void getBakeries().then((loadedBakeries) => {
            if (!isActive) return
            registerLegacyBakeryIds(loadedBakeries)
            setBakeries(loadedBakeries)
            setBakeriesLoadError('')
        }).catch((error: unknown) => {
            if (!isActive) return
            setBakeriesLoadError(error instanceof Error ? error.message : 'Não foi possível carregar as unidades.')
        }).finally(() => {
            if (isActive) setIsLoadingBakeries(false)
        })

        return () => {
            isActive = false
        }
    }, [])

    return { bakeries, setBakeries, isLoadingBakeries, bakeriesLoadError }
}