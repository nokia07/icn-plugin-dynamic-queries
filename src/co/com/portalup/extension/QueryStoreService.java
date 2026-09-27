package co.com.portalup.extension;

import java.io.IOException;
import java.io.PrintWriter;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import com.ibm.ecm.extension.PluginLogger;
import com.ibm.ecm.extension.PluginService;
import com.ibm.ecm.extension.PluginServiceCallbacks;
import com.ibm.json.java.JSONObject;

/**
 * Servicio del plug-in que usa el feature DQ para guardar y leer consultas. El navegador nunca llama a la API externa:
 * este servicio agrega el usuario de ICN y el token de servicio, que no salen del servidor.
 *
 * Parámetro operation: getSettings | listQueries | getQuery | saveQuery | deleteQuery. Las operaciones con cuerpo lo reciben como JSON. No se llama "action" porque ICN usa ese parámetro para
 * el id del servicio. La respuesta siempre es HTTP 200 con { ok: true, mode, data } o { ok: false, mode, error: { status, code,
 * message } }, para que el cliente muestre el error en su propio diálogo.
 *
 * Sin apiUrl en la configuración del plug-in se usa el modo simulado en memoria (InMemoryQueryStore).
 */
public class QueryStoreService extends PluginService {

	private static final int DEFAULT_TIMEOUT_SECONDS = 15;
	private static final int DEFAULT_PAGE_SIZE = 100;
	private static final int MAX_PAGE_SIZE = 500;

	public String getId() {
		return "QueryStoreService";
	}

	public void execute(PluginServiceCallbacks callbacks, HttpServletRequest request, HttpServletResponse response)
			throws Exception {
		PluginLogger logger = callbacks.getLogger();
		JSONObject result;
		try {
			// getUserId() resuelve el usuario con el parámetro repositoryId de la solicitud (NullPointerException si falta).
			// getSettings no lo necesita, y es justamente la operación que le dice al navegador qué repositorio usar.
			String user = "getSettings".equals(request.getParameter("operation")) ? null : callbacks.getUserId();
			result = handle(callbacks.loadConfiguration(), user, request, logger);
		} catch (Throwable t) {
			// También errores de la JVM (NoClassDefFoundError, NoSuchMethodError...), que catch (Exception) no atrapa:
			// sin esto ICN responde HTTP 599 sin cuerpo y el detalle solo queda en el log del servidor.
			logger.logError(this, "execute", "Error no controlado en QueryStoreService", t);
			result = new JSONObject();
			result.put("ok", Boolean.FALSE);
			result.put("error", error(500, "INTERNAL_ERROR",
					"Error inesperado en el servicio de consultas (" + t.getClass().getName() + ": " + t.getMessage() + ")."));
		}
		response.setContentType("application/json");
		response.setCharacterEncoding("UTF-8");
		// toString() y no serialize(Writer): es lo que usan los plug-ins que ya funcionan en el servidor (PortalUpICN).
		PrintWriter writer = response.getWriter();
		try {
			writer.print(result.toString());
			writer.flush();
		} finally {
			writer.close();
		}
	}

	/** Lógica del servicio, separada de PluginServiceCallbacks (que solo existe dentro de ICN) para poder probarla. */
	JSONObject handle(String configuration, String user, HttpServletRequest request, PluginLogger logger) {
		JSONObject result = new JSONObject();
		String operation = request.getParameter("operation");
		try {
			JSONObject config = PluginConfiguration.parse(configuration);
			String apiUrl = PluginConfiguration.get(config, PluginConfiguration.API_URL);
			QueryStore store;
			if (apiUrl.length() == 0) {
				store = InMemoryQueryStore.INSTANCE;
				result.put("mode", "memory");
			} else {
				int timeout = parseInt(PluginConfiguration.get(config, PluginConfiguration.TIMEOUT_SECONDS),
						DEFAULT_TIMEOUT_SECONDS);
				store = new HttpQueryStore(apiUrl, PluginConfiguration.get(config, PluginConfiguration.API_TOKEN),
						timeout * 1000);
				result.put("mode", "api");
			}

			result.put("data", dispatch(store, config, operation, user, request));
			result.put("ok", Boolean.TRUE);
		} catch (QueryStoreException e) {
			logger.logWarning(this, "handle",
					"operation=" + operation + " status=" + e.getStatus() + " code=" + e.getCode() + ": " + e.getMessage());
			result.put("ok", Boolean.FALSE);
			result.put("error", error(e.getStatus(), e.getCode(), e.getMessage()));
		} catch (Exception e) {
			logger.logError(this, "handle", "operation=" + operation, e);
			result.put("ok", Boolean.FALSE);
			result.put("error", error(500, "INTERNAL_ERROR", "Error inesperado al procesar la solicitud."));
		}
		return result;
	}

	private Object dispatch(QueryStore store, JSONObject config, String operation, String user,
			HttpServletRequest request) throws QueryStoreException, IOException {
		String repositoryId = PluginConfiguration.get(config, PluginConfiguration.REPOSITORY_ID);
		if ("getSettings".equals(operation)) {
			// Solo lo que necesita el navegador: nunca el token ni la URL del servicio.
			JSONObject settings = new JSONObject();
			settings.put("repositoryId", repositoryId);
			return settings;
		}
		if ("listQueries".equals(operation)) {
			int limit = Math.min(parseInt(request.getParameter("limit"), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
			int offset = Math.max(parseInt(request.getParameter("offset"), 0), 0);
			return store.listQueries(user, emptyToNull(request.getParameter("name")),
					emptyToNull(request.getParameter("sort")), limit, offset);
		}
		if ("getQuery".equals(operation)) {
			return store.getQuery(user, request.getParameter("id"));
		}
		if ("saveQuery".equals(operation)) {
			// Con id actualiza (el cuerpo debe traer la version leída); sin id crea.
			JSONObject body = readBody(request);
			checkRepository(body, repositoryId);
			Object id = body.remove("id");
			return id instanceof String && ((String) id).length() > 0 ? store.updateQuery(user, (String) id, body)
					: store.createQuery(user, body);
		}
		if ("deleteQuery".equals(operation)) {
			store.deleteQuery(user, request.getParameter("id"));
			return null;
		}
		throw new QueryStoreException(400, "UNKNOWN_OPERATION", "Operación no soportada: " + operation);
	}

	/** Con repositorio configurado, las consultas solo pueden usar ese repositorio. */
	private static void checkRepository(JSONObject query, String repositoryId) throws QueryStoreException {
		if (repositoryId.length() == 0) {
			return;
		}
		Object definition = query.get("definition");
		Object repository = definition instanceof JSONObject ? ((JSONObject) definition).get("repository") : null;
		Object id = repository instanceof JSONObject ? ((JSONObject) repository).get("id") : null;
		if (!repositoryId.equals(id)) {
			throw new QueryStoreException(400, "INVALID_REPOSITORY",
					"La consulta debe usar el repositorio configurado para el plug-in (" + repositoryId + ").");
		}
	}

	private static JSONObject readBody(HttpServletRequest request) throws QueryStoreException {
		try {
			return JSONObject.parse(request.getReader());
		} catch (IOException e) {
			throw new QueryStoreException(400, "INVALID_BODY", "La solicitud no trae un JSON válido.", e);
		}
	}

	private static JSONObject error(int status, String code, String message) {
		JSONObject error = new JSONObject();
		error.put("status", (long) status);
		error.put("code", code);
		error.put("message", message);
		return error;
	}

	private static int parseInt(String value, int defaultValue) {
		try {
			return value == null || value.trim().length() == 0 ? defaultValue : Integer.parseInt(value.trim());
		} catch (NumberFormatException e) {
			return defaultValue;
		}
	}

	private static String emptyToNull(String value) {
		return value == null || value.trim().length() == 0 ? null : value.trim();
	}
}
