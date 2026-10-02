/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** 'beta' só no pacote publicado em /beta/ (ver src/lib/canal.ts). */
  readonly VITE_CANAL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
