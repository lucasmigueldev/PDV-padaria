export interface ServiceWorkerEnvironment {
    DEV: boolean
    PROD: boolean
}

export interface ServiceWorkerRegistrar {
    register(
        scriptURL: string,
        options?: RegistrationOptions,
    ): Promise<ServiceWorkerRegistration>
}

export function registerAppServiceWorker(
    environment: ServiceWorkerEnvironment,
    serviceWorker: ServiceWorkerRegistrar,
): Promise<ServiceWorkerRegistration> | null {
    const scriptURL = environment.DEV
        ? '/sw-dev.js'
        : environment.PROD
            ? '/sw.js'
            : null

    if (!scriptURL) {
        return null
    }

    if (environment.DEV) {
        return serviceWorker.register(scriptURL, {
            scope: '/',
            updateViaCache: 'none',
        })
    }

    return serviceWorker.register(scriptURL)
}
