# Noviciado Run Club

Web del run club de Noviciado Coffee Shop (Malasaña, Madrid). La gente se apunta al próximo evento y vota cuánto quiere correr y cómo de dura quiere la ruta. Con esos votos genero el recorrido desde el panel de admin, lo publico en la web y al volver al café hay post-run con DJ.

Cada persona que se apunta por primera vez se lleva una tarjeta de socio con un QR. En cada quedada se la escaneo desde el panel y suma 10 puntos, que la hacen subir de nivel (Spark, Rolling, Lifted y High Runner).

## Cómo está montado

```
Web pública + panel de admin + tarjeta   →  GitHub Pages (HTML, CSS y JS sin compilar)
Eventos, inscripciones, rutas y socios   →  Cloudflare Worker + base de datos D1 (api/)
Generar la ruta                          →  el motor de Rutas Noviciado (js/rutas/), en el navegador
Correos (opcional)                       →  Brevo, plan gratuito
Tarjeta en Google Wallet (opcional)      →  API de Google Wallet, gratis
```

No hace falta tener ningún ordenador encendido y no cuesta nada. Los planes gratuitos dan de sobra: D1 permite 5 GB y millones de lecturas al día, el Worker 100.000 peticiones diarias y Brevo 300 correos al día.

- `index.html`: la web pública y el panel de admin (se entra con el botón de cuenta o con `#admin`).
- `tarjeta.html`: la tarjeta de socio con el QR. En el iPhone se guarda en la pantalla de inicio.
- `js/site.js`: evento, ruta publicada y formulario en dos pasos.
- `js/admin.js`, `js/admin-route.js` y `js/admin-checkin.js`: las pestañas Inscritos, Ruta, Fichar y Evento.
- `js/rutas/`: copia del generador de [Rutas Noviciado](https://github.com/danielcs94/rutas-noviciado), con el máximo de km por evento.
- `api/`: el Worker. Las tablas están en `api/migrations/`.

## Publicarlo (una vez)

Necesitas la cuenta gratuita de Cloudflare (la misma de la guía de lavado).

```bash
cd api
npm install
npx wrangler d1 create noviciado-run-club
```

Ese comando te da un `database_id`: cópialo en `api/wrangler.jsonc`. Después:

```bash
npm run db:remote
npx wrangler secret put ADMIN_PASSWORD
openssl rand -hex 32
npx wrangler secret put TOKEN_SECRET
npm run deploy
```

`ADMIN_PASSWORD` es la contraseña del panel. En `TOKEN_SECRET` pega lo que ha sacado `openssl` (sirve para firmar las sesiones; si lo cambias, se cierran todas). El deploy te da la dirección del Worker: tiene que coincidir con la de `js/config.js`.

Para la web, crea el repositorio `noviciado-run-club` en GitHub, súbelo y en Settings → Pages elige la rama `main` y la carpeta raíz. Quedará en https://danielcs94.github.io/noviciado-run-club/.

Dominio propio: el archivo `CNAME` pide `runclub.noviciado.com`. En Settings → Pages pon ese dominio en *Custom domain* y marca *Enforce HTTPS* cuando aparezca; Noviciado crea el registro DNS `runclub CNAME danielcs94.github.io` (sin proxy de Cloudflare). La dirección vieja redirige sola a la nueva.

Lo último es entrar al panel y crear el primer evento en la pestaña Evento.

**Antes de cada push** ejecuta `python3 tools/release.py`. GitHub Pages deja que el móvil guarde los archivos 10 minutos y sin versiones puede mezclar archivos viejos y nuevos.

## Correos con Brevo (opcional)

1. Crea una cuenta en [Brevo](https://www.brevo.com) y verifica el correo remitente (Senders & IP).
2. Pon ese correo en `MAIL_FROM_EMAIL` de `api/wrangler.jsonc`.
3. Crea una API key (SMTP & API → API Keys) y guárdala con `npx wrangler secret put BREVO_API_KEY`.
4. `npm run deploy`.

Mientras tanto el panel deja ver la vista previa pero no enviar. La plantilla está en `api/src/email.ts` y de momento es provisional. Con un dominio propio y su DNS configurado en Brevo, los correos no acaban en spam.

## Tarjeta en Google Wallet (opcional)

1. En la [consola de Google Pay & Wallet](https://pay.google.com/business/console) crea una cuenta de emisor y copia el Issuer ID en `GW_ISSUER_ID` de `api/wrangler.jsonc`.
2. En Google Cloud crea un proyecto, activa la Google Wallet API y crea una cuenta de servicio con una clave JSON.
3. En la consola de Wallet, añade el correo de esa cuenta de servicio como usuario.
4. `npx wrangler secret put GW_SA_EMAIL` (el `client_email` del JSON) y `npx wrangler secret put GW_SA_KEY` (el `private_key`, entero).
5. `npm run deploy`.

Hasta que Google apruebe la cuenta de emisor solo funciona para las cuentas de prueba que añadas en la consola. En iPhone la tarjeta es la web: Apple Wallet necesita el programa de desarrollador de Apple (99 $ al año).

## Programar en local

```bash
cd api
cp .dev.vars.example .dev.vars
npm run db:local
npx wrangler d1 execute noviciado-run-club --local --file=demo.sql
npm run dev
```

En `.dev.vars` va la contraseña del panel para local. `demo.sql` crea un evento y 16 inscritos inventados para ver el panel con datos (solo en local). En otra terminal, desde `noviciado-run-club/`:

```bash
python3 tools/serve.py
```

La web queda en http://localhost:5184 y la API en http://localhost:8787. Desde el móvil, con la misma wifi, entra con la IP del Mac.
