package co.com.portalup.extension;

import com.ibm.json.java.JSONObject;

/**
 * Cliente de la API REST externa de consultas (docs/api/dynamic-queries.openapi.yaml). Se autentica con el token de
 * servicio configurado en el plug-in y envía el usuario de ICN en X-ICN-User. Los errores de la API llegan como
 * QueryStoreException con el código y el mensaje que devolvió el servicio.
 */
public class HttpQueryStore implements QueryStore {

	private final RestClient client;

	public HttpQueryStore(String baseUrl, String token, int timeoutMillis) {
		this.client = new RestClient(baseUrl, token, timeoutMillis, "el servicio de consultas");
	}

	public JSONObject listQueries(String user, String name, String sort, int limit, int offset)
			throws QueryStoreException {
		StringBuilder path = new StringBuilder("/queries?limit=").append(limit).append("&offset=").append(offset);
		appendParam(path, "name", name);
		appendParam(path, "sort", sort);
		return (JSONObject) client.send("GET", path.toString(), user, null);
	}

	public JSONObject getQuery(String user, String queryId) throws QueryStoreException {
		return (JSONObject) client.send("GET", "/queries/" + RestClient.encode(queryId), user, null);
	}

	public JSONObject createQuery(String user, JSONObject input) throws QueryStoreException {
		return (JSONObject) client.send("POST", "/queries", user, input);
	}

	public JSONObject updateQuery(String user, String queryId, JSONObject input) throws QueryStoreException {
		return (JSONObject) client.send("PUT", "/queries/" + RestClient.encode(queryId), user, input);
	}

	public void deleteQuery(String user, String queryId) throws QueryStoreException {
		client.send("DELETE", "/queries/" + RestClient.encode(queryId), user, null);
	}

	private static void appendParam(StringBuilder path, String name, String value) {
		if (value != null && value.length() > 0) {
			path.append('&').append(name).append('=').append(RestClient.encode(value));
		}
	}
}
