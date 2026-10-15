import { useEffect, useState } from 'react'

import { getBakeries } from '../services/bakeries'
import type { Bakery } from '../types/Bakery'

export function useBakeries() {
    const [bakeries, setBakeries] = useState<Bakery[]>([])
    const [isLoadingBakeries, setIsLoadingBakeries] = useState(true)
    const [bakeriesLoadError, setBakeriesLoadError] = useState('')

    useEffect(() => {
        let isActive = true

        void getBakeries().then((loadedBakeries) => {
            if (!isActive) return
            setBakeries(loadedBakeries)
            setBakeriesLoadError('')
        }).catch((error: unknown) => {
            if (!isActive) return
            console.error('Erro ao carregar as unidades disponíveis.', error)
            setBakeriesLoadError(error instanceof TypeError
                ? 'Não foi possível conectar ao sistema para carregar as unidades. Verifique sua conexão e tente novamente.'
                : 'Não foi possível carregar as unidades. Atualize a tela e tente novamente.')
        }).finally(() => {
            if (isActive) setIsLoadingBakeries(false)
        })

        return () => {
            isActive = false
        }
    }, [])

    return { bakeries, setBakeries, isLoadingBakeries, bakeriesLoadError }
}