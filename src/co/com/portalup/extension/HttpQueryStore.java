package co.com.portalup.extension;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UnsupportedEncodingException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;

import com.ibm.json.java.JSON;
import com.ibm.json.java.JSONArtifact;
import com.ibm.json.java.JSONObject;

/**
 * Cliente de la API REST externa de consultas (docs/api/dynamic-queries.openapi.yaml). Se autentica con el token de
 * servicio configurado en el plug-in y envía el usuario de ICN en X-ICN-User. Los errores de la API llegan como
 * QueryStoreException con el código y el mensaje que devolvió el servicio.
 */
public class HttpQueryStore implements QueryStore {

	private final String baseUrl;
	private final String token;
	private final int timeoutMillis;

	public HttpQueryStore(String baseUrl, String token, int timeoutMillis) {
		this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
		this.token = token;
		this.timeoutMillis = timeoutMillis;
	}

	public JSONObject listQueries(String user, String name, String sort, int limit, int offset)
			throws QueryStoreException {
		StringBuilder path = new StringBuilder("/queries?limit=").append(limit).append("&offset=").append(offset);
		appendParam(path, "name", name);
		appendParam(path, "sort", sort);
		return (JSONObject) send("GET", path.toString(), user, null);
	}

	public JSONObject getQuery(String user, String queryId) throws QueryStoreException {
		return (JSONObject) send("GET", "/queries/" + encode(queryId), user, null);
	}

	public JSONObject createQuery(String user, JSONObject input) throws QueryStoreException {
		return (JSONObject) send("POST", "/queries", user, input);
	}

	public JSONObject updateQuery(String user, String queryId, JSONObject input) throws QueryStoreException {
		return (JSONObject) send("PUT", "/queries/" + encode(queryId), user, input);
	}

	public void deleteQuery(String user, String queryId) throws QueryStoreException {
		send("DELETE", "/queries/" + encode(queryId), user, null);
	}

	private JSONArtifact send(String method, String path, String user, JSONObject body) throws QueryStoreException {
		HttpURLConnection connection = null;
		try {
			connection = (HttpURLConnection) new URL(baseUrl + path).openConnection();
			connection.setRequestMethod(method);
			connection.setConnectTimeout(timeoutMillis);
			connection.setReadTimeout(timeoutMillis);
			connection.setRequestProperty("Accept", "application/json");
			// Las cabeceras HTTP no admiten UTF-8: el usuario va codificado como URL (el contrato lo documenta).
			connection.setRequestProperty("X-ICN-User", encode(user));
			if (token != null && token.length() > 0) {
				connection.setRequestProperty("Authorization", "Bearer " + token);
			}
			if (body != null) {
				connection.setDoOutput(true);
				connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
				OutputStream out = connection.getOutputStream();
				try {
					out.write(body.toString().getBytes("UTF-8"));
				} finally {
					out.close();
				}
			}

			int status = connection.getResponseCode();
			String text = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
			if (status >= 400) {
				throw toException(status, text);
			}
			return text.trim().length() == 0 ? null : JSON.parse(text);
		} catch (IOException e) {
			throw new QueryStoreException(503, "SERVICE_UNAVAILABLE",
					"No se pudo comunicar con el servicio de consultas. Intente de nuevo más tarde.", e);
		} finally {
			if (connection != null) {
				connection.disconnect();
			}
		}
	}

	/** Usa el Error { code, message } del contrato si la respuesta lo trae. */
	private static QueryStoreException toException(int status, String text) {
		try {
			JSONObject error = JSONObject.parse(text);
			if (error.get("message") instanceof String) {
				Object code = error.get("code");
				return new QueryStoreException(status, code instanceof String ? (String) code : "HTTP_" + status,
						(String) error.get("message"));
			}
		} catch (IOException e) {
			// Cuerpo que no es JSON: se usa el mensaje genérico.
		}
		return new QueryStoreException(status, "HTTP_" + status,
				"El servicio de consultas respondió con un error (HTTP " + status + ").");
	}

	private static String read(InputStream in) throws IOException {
		if (in == null) {
			return "";
		}
		try {
			ByteArrayOutputStream buffer = new ByteArrayOutputStream();
			byte[] chunk = new byte[8192];
			for (int n; (n = in.read(chunk)) != -1;) {
				buffer.write(chunk, 0, n);
			}
			return buffer.toString("UTF-8");
		} finally {
			in.close();
		}
	}

	private static void appendParam(StringBuilder path, String name, String value) {
		if (value != null && value.length() > 0) {
			path.append('&').append(name).append('=').append(encode(value));
		}
	}

	private static String encode(String value) {
		try {
			return URLEncoder.encode(value, "UTF-8").replace("+", "%20");
		} catch (UnsupportedEncodingException e) {
			throw new IllegalStateException(e);
		}
	}
}
