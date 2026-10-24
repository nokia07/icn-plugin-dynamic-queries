package co.com.portalup.extension;

import java.io.IOException;
import java.net.SocketTimeoutException;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.ibm.json.java.JSONArray;
import com.ibm.json.java.JSONObject;

/**
 * Composición de los documentos de Imagine en S3, con un objeto por página en file_key_multivalue: POST
 * {s3DownloadUrl} con { storageName, objetos, idDocumento }, las cabeceras x-api-key y Authorization: Bearer (token de
 * AzureTokenProvider). La Lambda junta los objetos en un PDF, lo publica en S3 y responde
 * { cabeceraSalida: { codigo, tipoError, mensajeUsuario }, documento: { url, expiraEnSegundos, paginas, tamanoBytes,
 * reutilizado } }: url es una URL prefirmada (vence en minutos) de la que el servidor de ICN descarga el PDF (download):
 * el navegador no se conecta a S3, solo el servidor tiene visibilidad de los servicios. Luego el PDF llega a FileNet como
 * versión 2 del documento y ya no hace falta componerlo (DocumentPropertiesService).
 */
final class S3Composer implements DocumentPropertiesService.DocumentComposer {

	private static final int CONNECT_TIMEOUT_MS = 10000;
	private static final int DOWNLOAD_READ_TIMEOUT_MS = 60000;
	/** Tope del PDF que se descarga a memoria para enviarlo en base64 (~200 páginas de Imagine pesan unos 10 MB). */
	static final long MAX_PDF_BYTES = 100L * 1024 * 1024;

	/** Documento compuesto; url no se envía al navegador. */
	static final class ComposedDocument {
		final String url;
		final Long expiresInSeconds;
		final Long pages;
		final Long sizeBytes;
		final boolean reused;

		ComposedDocument(String url, Long expiresInSeconds, Long pages, Long sizeBytes, boolean reused) {
			this.url = url;
			this.expiresInSeconds = expiresInSeconds;
			this.pages = pages;
			this.sizeBytes = sizeBytes;
			this.reused = reused;
		}

		JSONObject toJson() {
			JSONObject json = new JSONObject();
			json.put("pages", pages);
			json.put("sizeBytes", sizeBytes);
			json.put("reused", Boolean.valueOf(reused));
			return json;
		}
	}

	/** La composición no respondió en el timeout configurado: sigue en proceso. */
	static final class ComposePendingException extends Exception {
		private static final long serialVersionUID = 1L;

		ComposePendingException(int seconds) {
			super("La composición del documento no respondió en " + seconds + " s.");
		}
	}

	private final String url;
	private final String apiKey;
	private final AzureTokenProvider tokens;
	private final int timeoutSeconds;

	S3Composer(String url, String apiKey, AzureTokenProvider tokens, int timeoutSeconds) {
		this.url = url;
		this.apiKey = apiKey;
		this.tokens = tokens;
		this.timeoutSeconds = timeoutSeconds;
	}

	public ComposedDocument compose(String storageName, List<String> objects, String documentId)
			throws IOException, ComposePendingException {
		JSONArray list = new JSONArray();
		list.addAll(objects);
		JSONObject request = new JSONObject();
		request.put("storageName", storageName);
		request.put("objetos", list);
		request.put("idDocumento", documentId);
		String body = request.serialize();
		try {
			Http.Response response = post(body, tokens.getToken());
			// Token vencido o revocado antes de lo que decía expires_on: se pide otro una vez.
			if (response.status == 401 || response.status == 403) {
				tokens.invalidate();
				response = post(body, tokens.getToken());
			}
			return parse(response.status, response.body);
		} catch (SocketTimeoutException e) {
			throw new ComposePendingException(timeoutSeconds);
		}
	}

	/** PDF de la URL prefirmada de una composición, en base64. */
	public String download(String documentUrl) throws IOException {
		return Base64.getEncoder().encodeToString(
				Http.getBytes(documentUrl, CONNECT_TIMEOUT_MS, DOWNLOAD_READ_TIMEOUT_MS, MAX_PDF_BYTES));
	}

	private Http.Response post(String body, String token) throws IOException {
		Map<String, String> headers = new HashMap<String, String>();
		headers.put("Authorization", "Bearer " + token);
		if (apiKey.length() > 0) {
			headers.put("x-api-key", apiKey);
		}
		return Http.post(url, "application/json", body, headers, CONNECT_TIMEOUT_MS, timeoutSeconds * 1000);
	}

	/** Éxito solo con HTTP 2xx, cabeceraSalida.codigo "0" y documento.url; si no, IOException con mensajeUsuario. */
	static ComposedDocument parse(int status, String body) throws IOException {
		JSONObject json = null;
		try {
			json = JSONObject.parse(body);
		} catch (Exception e) {
			// Sin JSON (p. ej. un error del gateway en HTML): el mensaje lleva el inicio del cuerpo.
		}
		JSONObject header = json == null ? null : object(json.get("cabeceraSalida"));
		JSONObject document = json == null ? null : object(json.get("documento"));
		String code = header == null ? "" : text(header.get("codigo"));
		String documentUrl = document == null ? "" : text(document.get("url"));
		if (status >= 200 && status < 300 && "0".equals(code) && documentUrl.length() > 0) {
			return new ComposedDocument(documentUrl, number(document.get("expiraEnSegundos")),
					number(document.get("paginas")), number(document.get("tamanoBytes")),
					Boolean.TRUE.equals(document.get("reutilizado")) || "true".equals(text(document.get("reutilizado"))));
		}
		String message = header == null ? "" : text(header.get("mensajeUsuario"));
		if (message.length() == 0 && json != null) {
			message = text(json.get("message"));
		}
		if (message.length() == 0 && json == null) {
			String start = body == null ? "" : body.trim();
			message = start.length() > 200 ? start.substring(0, 200) + "…" : start;
		}
		String type = header == null ? "" : text(header.get("tipoError"));
		throw new IOException("HTTP " + status + (code.length() > 0 ? ", código " + code : "")
				+ (type.length() > 0 ? " (" + type + ")" : "") + (message.length() > 0 ? ": " + message : ""));
	}

	private static JSONObject object(Object value) {
		return value instanceof JSONObject ? (JSONObject) value : null;
	}

	private static Long number(Object value) {
		if (value instanceof Number) {
			return Long.valueOf(((Number) value).longValue());
		}
		try {
			return value == null ? null : Long.valueOf(value.toString().trim());
		} catch (NumberFormatException e) {
			return null;
		}
	}

	private static String text(Object value) {
		return value == null ? "" : value.toString().trim();
	}
}
