package co.com.portalup.extension;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UnsupportedEncodingException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.util.Map;

/**
 * POST y GET mínimos con HttpURLConnection para la composición de documentos (AzureTokenProvider, S3Composer). La
 * descarga de file_key (DocumentPropertiesService.httpDownloader) no los usa.
 */
final class Http {

	/** Estado y cuerpo de una respuesta (también las de error). */
	static final class Response {
		final int status;
		final String body;

		Response(int status, String body) {
			this.status = status;
			this.body = body;
		}

		boolean isSuccess() {
			return status >= 200 && status < 300;
		}
	}

	private Http() {
	}

	/**
	 * POST de body (UTF-8). No conectarse en connectMs es un IOException normal; solo no recibir la respuesta en
	 * readMs lanza SocketTimeoutException, para que quien llama distinga "el servicio está tardando" de "no responde".
	 */
	static Response post(String url, String contentType, String body, Map<String, String> headers, int connectMs,
			int readMs) throws IOException {
		HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
		try {
			connection.setRequestMethod("POST");
			connection.setConnectTimeout(connectMs);
			connection.setReadTimeout(readMs);
			connection.setDoOutput(true);
			connection.setRequestProperty("Content-Type", contentType);
			connection.setRequestProperty("Accept", "application/json");
			if (headers != null) {
				for (Map.Entry<String, String> header : headers.entrySet()) {
					connection.setRequestProperty(header.getKey(), header.getValue());
				}
			}
			try {
				connection.connect();
			} catch (SocketTimeoutException e) {
				throw new IOException("no se pudo conectar con " + new URL(url).getHost() + " en " + connectMs + " ms", e);
			}
			OutputStream output = connection.getOutputStream();
			try {
				output.write(body.getBytes("UTF-8"));
			} finally {
				output.close();
			}
			int status = connection.getResponseCode();
			InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
			return new Response(status, input == null ? "" : read(input));
		} finally {
			connection.disconnect();
		}
	}

	/**
	 * GET de un archivo binario (p. ej. una URL prefirmada de S3), hasta maxBytes; IOException si la respuesta no es 2xx
	 * o pasa el límite.
	 */
	static byte[] getBytes(String url, int connectMs, int readMs, long maxBytes) throws IOException {
		HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
		try {
			connection.setRequestMethod("GET");
			connection.setConnectTimeout(connectMs);
			connection.setReadTimeout(readMs);
			int status = connection.getResponseCode();
			if (status < 200 || status >= 300) {
				InputStream error = connection.getErrorStream();
				String body = error == null ? "" : read(error).trim();
				throw new IOException("HTTP " + status + (body.length() == 0 ? ""
						: ": " + (body.length() > 200 ? body.substring(0, 200) + "…" : body)));
			}
			if (connection.getContentLengthLong() > maxBytes) {
				throw new IOException("el archivo pesa " + connection.getContentLengthLong() + " bytes (máximo " + maxBytes + ")");
			}
			return readBytes(connection.getInputStream(), maxBytes);
		} finally {
			connection.disconnect();
		}
	}

	static String read(InputStream input) throws IOException {
		try {
			return new String(readBytes(input, Long.MAX_VALUE), "UTF-8");
		} catch (UnsupportedEncodingException e) {
			throw new IOException(e);
		}
	}

	private static byte[] readBytes(InputStream input, long maxBytes) throws IOException {
		try {
			ByteArrayOutputStream output = new ByteArrayOutputStream();
			byte[] buffer = new byte[8192];
			int read;
			while ((read = input.read(buffer)) != -1) {
				output.write(buffer, 0, read);
				if (output.size() > maxBytes) {
					throw new IOException("el archivo pasa el máximo de " + maxBytes + " bytes");
				}
			}
			return output.toByteArray();
		} finally {
			input.close();
		}
	}
}
