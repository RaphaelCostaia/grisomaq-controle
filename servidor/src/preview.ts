/**
 * Sobe o PWA JÁ CONSTRUÍDO com a API no mesmo endereço.
 *
 * É o formato para testar instalação e uso offline em celular: um endereço só,
 * sem CORS, pronto para passar por um túnel HTTPS — que é o que o navegador
 * exige para instalar um PWA e guardá-lo offline.
 *
 * Continua sendo ambiente de teste: o banco vive na memória e some ao encerrar.
 *
 *   npm run preview:pwa
 */
process.env.SERVIR_DIST = '1'
process.env.HOST = '0.0.0.0'
process.env.PORTA ??= '4180'
process.env.ORIGENS_PERMITIDAS = '*'

await import('./servidor-de-teste.ts')
