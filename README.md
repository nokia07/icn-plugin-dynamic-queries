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

## API de consultas

El feature DQ envía las consultas a un servicio REST externo. Su contrato (borrador) está en [`docs/api/dynamic-queries.openapi.yaml`](docs/api/dynamic-queries.openapi.yaml).
