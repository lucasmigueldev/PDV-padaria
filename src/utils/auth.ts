import type { NavigateFunction } from 'react-router-dom'
import { signOut } from '../services/auth'

export async function logoutAndRedirect(navigate: NavigateFunction): Promise<void> {
    try {
        await signOut()
    } catch (error) {
        console.error('Não foi possível encerrar a sessão Supabase.', error)
    } finally {
        navigate('/login', { replace: true })
    }
}
