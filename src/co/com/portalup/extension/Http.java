package co.com.portalup.extension;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.util.Map;

/** POST mínimo con HttpURLConnection para los servicios que llama el servidor de ICN (AzureTokenProvider, S3Composer). */
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

	static String read(InputStream input) throws IOException {
		try {
			ByteArrayOutputStream output = new ByteArrayOutputStream();
			byte[] buffer = new byte[8192];
			int read;
			while ((read = input.read(buffer)) != -1) {
				output.write(buffer, 0, read);
			}
			return output.toString("UTF-8");
		} finally {
			input.close();
		}
	}
}
