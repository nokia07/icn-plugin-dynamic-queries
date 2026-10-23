package co.com.portalup.extension;

import java.io.IOException;
import java.net.URLEncoder;
import java.util.HashMap;
import java.util.Map;

import com.ibm.json.java.JSONObject;

/**
 * Token de Azure AD para el servicio de composición (S3Composer): flujo client_credentials del endpoint v1
 * (/oauth2/token con resource). Se guarda en memoria, compartido por todas las solicitudes, hasta RENEW_MARGIN_MS antes
 * de que venza: dura ~1 hora y pedirlo en cada clic gastaría parte del timeout de la composición.
 */
final class AzureTokenProvider {

	private static final long RENEW_MARGIN_MS = 5 * 60 * 1000L;
	/** Si la respuesta no trae expires_on ni expires_in. */
	private static final long DEFAULT_LIFETIME_MS = 30 * 60 * 1000L;
	private static final int CONNECT_TIMEOUT_MS = 10000;
	private static final int READ_TIMEOUT_MS = 10000;

	/** Por configuración (URL, cliente, secreto, resource): si el administrador la cambia, no se usa el token viejo. */
	private static final Map<String, Token> CACHE = new HashMap<String, Token>();

	static final class Token {
		final String value;
		final long expiresAt;

		Token(String value, long expiresAt) {
			this.value = value;
			this.expiresAt = expiresAt;
		}
	}

	private final String tokenUrl;
	private final String clientId;
	private final String clientSecret;
	private final String resource;
	private final String key;

	AzureTokenProvider(String tokenUrl, String clientId, String clientSecret, String resource) {
		this.tokenUrl = tokenUrl;
		this.clientId = clientId;
		this.clientSecret = clientSecret;
		this.resource = resource;
		this.key = tokenUrl + "\n" + clientId + "\n" + clientSecret + "\n" + resource;
	}

	/** El token guardado o uno nuevo si no hay o está por vencer. */
	String getToken() throws IOException {
		synchronized (CACHE) {
			Token token = CACHE.get(key);
			if (token != null && System.currentTimeMillis() < token.expiresAt - RENEW_MARGIN_MS) {
				return token.value;
			}
		}
		// Fuera del bloqueo: dos solicitudes simultáneas pueden pedir cada una su token, pero ninguna espera a la otra.
		String form = "grant_type=client_credentials&client_id=" + encode(clientId) + "&client_secret="
				+ encode(clientSecret) + "&resource=" + encode(resource);
		Http.Response response = Http.post(tokenUrl, "application/x-www-form-urlencoded", form, null, CONNECT_TIMEOUT_MS,
				READ_TIMEOUT_MS);
		Token token = parse(response.status, response.body, System.currentTimeMillis());
		synchronized (CACHE) {
			CACHE.put(key, token);
		}
		return token.value;
	}

	/** Descarta el token guardado (el servicio lo rechazó). */
	void invalidate() {
		synchronized (CACHE) {
			CACHE.remove(key);
		}
	}

	/**
	 * Respuesta del endpoint v1: { token_type, access_token, expires_in, expires_on, … } (números como texto); en error
	 * { error, error_description }, cuya primera línea es el mensaje (AADSTS…).
	 */
	static Token parse(int status, String body, long now) throws IOException {
		JSONObject json;
		try {
			json = JSONObject.parse(body);
		} catch (Exception e) {
			throw new IOException("Azure AD respondió HTTP " + status + " sin JSON");
		}
		String accessToken = text(json.get("access_token"));
		if (status < 200 || status >= 300 || accessToken.length() == 0) {
			String description = text(json.get("error_description"));
			if (description.length() == 0) {
				description = text(json.get("error"));
			}
			int newline = description.indexOf('\n');
			throw new IOException("Azure AD respondió HTTP " + status + ": "
					+ (newline < 0 ? description : description.substring(0, newline)).trim());
		}
		long expiresAt;
		try {
			String expiresOn = text(json.get("expires_on"));
			expiresAt = expiresOn.length() > 0 ? Long.parseLong(expiresOn) * 1000L
					: now + Long.parseLong(text(json.get("expires_in"))) * 1000L;
		} catch (NumberFormatException e) {
			expiresAt = now + DEFAULT_LIFETIME_MS;
		}
		return new Token(accessToken, expiresAt);
	}

	private static String encode(String value) throws IOException {
		return URLEncoder.encode(value, "UTF-8");
	}

	private static String text(Object value) {
		return value == null ? "" : value.toString().trim();
	}
}
