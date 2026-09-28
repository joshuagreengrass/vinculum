# Vinculum — sitio del fanfic

Sitio estático (HTML + CSS + JS, sin build ni dependencias) para publicar *Vinculum* por capítulos, en español e inglés.
El diseño no se toca nunca para publicar: **todo el contenido sale de `data/chapters.json`, `chapters/` y `media/covers/`**.

```
vinculum/
├── index.html            ← estructura (no se toca)
├── css/styles.css        ← diseño (no se toca para publicar)
├── js/app.js             ← lógica: carrusel, lector, idiomas
├── js/markdown.js        ← convierte los .md a HTML
├── data/
│   ├── chapters.json     ← ★ LISTA DE CAPÍTULOS (lo único que editás al publicar)
│   └── site.json         ← textos de la interfaz en ES/EN, autor, idioma por defecto
├── chapters/
│   ├── es/01.md …        ← texto de cada capítulo en español
│   └── en/01.md …        ← texto de cada capítulo en inglés
├── media/covers/         ← portadas: imagen (.jpg/.png/.webp) o video (.mp4/.webm)
├── fonts/                ← tipografías auto-alojadas (licencia OFL)
├── scripts/new-chapter.mjs ← opcional: crea la entrada y los .md de un capítulo nuevo
└── vercel.json           ← caché y URLs limpias en Vercel
```

## Publicar un capítulo nuevo

1. **Texto**: creá `chapters/es/06.md` y `chapters/en/06.md`.
2. **Portada**: subí la imagen o el video a `media/covers/` (ej. `06.mp4`).
3. **Registro**: agregá un bloque al final de `data/chapters.json`:

```json
{
  "id": "06",
  "number": 6,
  "date": "2026-10-12",
  "cover": "media/covers/06.mp4",
  "poster": "media/covers/06.jpg",
  "title":   { "es": "Título en español", "en": "English title" },
  "summary": { "es": "Frase corta para la tarjeta.", "en": "Short line for the card." },
  "file":    { "es": "chapters/es/06.md", "en": "chapters/en/06.md" }
}
```

(Ojo con la coma entre bloques: el bloque anterior tiene que terminar en `},`.)

4. `git add . && git commit -m "Capítulo 06" && git push` → Vercel publica solo en ~30 segundos.

Atajo opcional (necesita Node): `node scripts/new-chapter.mjs --es "Título" --en "Title" --date 2026-10-12 --cover media/covers/06.mp4` crea la entrada y los dos `.md` vacíos.

### Campos de `chapters.json`

| Campo | Obligatorio | Qué hace |
|---|---|---|
| `id` | sí | Identificador corto; aparece en la URL (`/#/es/06`). No lo cambies después de publicar. |
| `number` | sí | Orden de lectura y número que se muestra. |
| `date` | sí | Fecha de publicación, formato `AAAA-MM-DD`. |
| `cover` | sí | Ruta a la portada: imagen (`.jpg`, `.png`, `.webp`), **GIF animado** (`.gif`) o video (`.mp4`/`.webm`, se reproduce en loop y sin sonido). |
| `poster` | no | Imagen que se ve mientras carga el video (y si el navegador no puede reproducirlo). |
| `title` | sí | Título en cada idioma. |
| `summary` | no | Frase que acompaña al título en la tarjeta del carrusel. |
| `file` | sí | Ruta al `.md` de cada idioma. Si falta un idioma, se muestra el otro con un aviso. |
| `minutes` | no | Minutos de lectura. Si no está, se calculan solos a partir del texto. |
| `layout` | no | Forzar el formato de tarjeta: `"a"`, `"b"` (grande) o `"c"` (texto arriba). Por defecto alternan a-b-c. |
| `draft` | no | `true` para ocultarlo por completo sin borrarlo. |

## Estados de un capítulo

Se deciden solos según `draft` y `date` (a la medianoche de la hora de cada lector):

| Estado | Condición | Cómo se ve |
|---|---|---|
| Borrador | `"draft": true` | No aparece en ningún lado. |
| Próximamente | sin draft, `date` en el futuro | En el carrusel, en gris y sin clic: recuadro con el número en gótica, título y "Disponible el: fecha". Al final del capítulo anterior aparece "Próximamente · fecha", también sin clic. |
| Publicado | sin draft, `date` hoy o antes | Normal. Si salió en los últimos 7 días, lleva la pill **Nuevo / New** sobre la portada. |

El texto al lado de "Vinculum" (Capítulo Nº… · mes) muestra siempre el **último publicado**: el de número más alto con fecha de hoy o anterior y sin draft.

Así podés dejar subido un capítulo con fecha futura (texto y portada incluidos) y se libera solo ese día, sin volver a hacer push. Mientras tanto, la portada y el texto no se muestran, aunque técnicamente los archivos ya estén en el servidor.

### Vista previa

Agregá `?preview` a la URL (ej. `https://tu-sitio.vercel.app/?preview`) para ver el sitio **como si todo ya estuviera publicado**: los capítulos en `draft` y los de fecha futura aparecen normales, con portada, y se pueden abrir y leer. El texto al lado de "Vinculum" muestra el capítulo de número más alto, y los de fecha futura llevan la pill "Nuevo", como la tendrán el día que salgan. Arriba aparece la etiqueta "Vista previa" / "Preview". Los visitantes sin el parámetro no ven nada distinto. El parámetro se mantiene al abrir capítulos y cambiar de idioma.

## Cómo escribir los `.md`

- Párrafos separados por una línea en blanco. Un salto de línea simple se respeta.
- `*cursiva*`, `**negrita**`, `> cita`, `# subtítulo`.
- Cambio de escena: una línea con `* * *` (o `***`, o `---`) → se dibuja como ✦ ✦ ✦.
- Diálogos: podés usar raya (`—Hola`) o guion (`- Hola`); el guion al inicio de línea se convierte en raya.
- El título **no** va en el `.md`: sale del JSON. (Si ponés un `# Título` en la primera línea, se ignora.)
- Imágenes dentro del capítulo: `![](media/capitulos/06-carta.jpg)`.

## Portadas

- Imagen: vertical u horizontal, ~1200 px de lado mayor, JPG/WebP de menos de 400 KB.
- GIF: funciona igual que una imagen (`"cover": "media/covers/06.gif"`). Los GIF pesan mucho: si pasa de ~5 MB, convertilo a MP4 (misma animación, 10–20 veces más liviano), por ejemplo con `ffmpeg -i 06.gif -movflags +faststart -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" 06.mp4`.
- Video: MP4 (H.264), sin audio, 4–10 s en loop, idealmente < 3 MB. Agregá siempre un `poster`.
- Los videos del carrusel solo se reproducen cuando están en pantalla.

## Modo claro / oscuro

El botón sol/luna (al lado del selector de idioma, también dentro del lector) alterna entre fondo claro y fondo negro con letras blancas. Se recuerda la elección; en la primera visita se usa la preferencia del sistema.
Los colores de cada modo están arriba de todo en `css/styles.css` (`:root` para claro, `:root[data-theme="dark"]` para oscuro).

## Idiomas

El selector ES / EN cambia la interfaz y el capítulo abierto (mantiene la posición de lectura). Se recuerda la elección; la primera visita usa el idioma del navegador.
Los textos de botones y etiquetas están en `data/site.json → ui`.

## Probar en tu computadora

Los navegadores no dejan cargar el JSON abriendo `index.html` con doble clic; hace falta un servidor local:

```bash
cd vinculum
python3 -m http.server 8000      # o: npx serve .
```

y abrí <http://localhost:8000>.

## Subir a GitHub y conectar Vercel (una sola vez)

1. Creá un repositorio vacío en GitHub (ej. `vinculum`).
2. En esta carpeta:
   ```bash
   git init
   git add .
   git commit -m "Vinculum: primera versión"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/vinculum.git
   git push -u origin main
   ```
3. En [vercel.com/new](https://vercel.com/new) → importá el repositorio → **Framework Preset: Other**, sin build command ni output directory → Deploy.
4. Desde ahí, cada `git push` publica automáticamente.

Para las vistas previas al compartir el link (Open Graph), cambiá en `index.html` el `og:image` por la URL completa, ej. `https://vinculum.vercel.app/media/og.jpg`.

## Contenido de ejemplo

Los capítulos 01–05, sus textos y las portadas abstractas de `media/covers/` son de relleno para ver el diseño funcionando: reemplazalos o borralos (y sus bloques en `chapters.json`).
