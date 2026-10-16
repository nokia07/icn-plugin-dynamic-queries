# icn-plugin-dynamic-queries

Plug-in de IBM Content Navigator (ICN).

## Requisitos

Las librerías de IBM no se incluyen en el repositorio. Antes de compilar, copia en la carpeta `lib/`:

- `navigatorAPI.jar` — API de ICN (disponible en la instalación de Content Navigator).
- `j2ee.jar` — API de Servlets.

## Compilar

```sh
ant
```

Genera `DynamicQueriesICNPlugin.jar`, que se registra en la herramienta de administración de ICN (Plugins).

## Microservicio de consultas y proyectos

El feature DQ guarda las consultas (`/api/v1/query`) y los proyectos (`/api/v1/project`) en el microservicio de DQ
(repositorio `icn-api-dynamic-queries`), al que llama directamente el navegador. Su URL base se configura en el
plug-in; debe usar https (la Content-Security-Policy de ICN bloquea otras URL http) y permitir CORS desde ICN.

Cada consulta guarda su CE SQL y, en `config`, la definición que permite volver a abrirla en el constructor
(esquema `QueryDefinition` de [`docs/api/dynamic-queries.openapi.yaml`](docs/api/dynamic-queries.openapi.yaml); los
endpoints de ese borrador ya no se usan).
