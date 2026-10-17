package co.com.portalup.extension;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

import javax.security.auth.Subject;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import com.filenet.api.collection.IndependentObjectSet;
import com.filenet.api.core.Document;
import com.filenet.api.core.ObjectStore;
import com.filenet.api.property.FilterElement;
import com.filenet.api.property.Properties;
import com.filenet.api.property.PropertyFilter;
import com.filenet.api.query.SearchSQL;
import com.filenet.api.query.SearchScope;
import com.filenet.api.util.UserContext;
import com.ibm.ecm.extension.PluginLogger;
import com.ibm.ecm.extension.PluginService;
import com.ibm.ecm.extension.PluginServiceCallbacks;
import com.ibm.json.java.JSONArray;
import com.ibm.json.java.JSONObject;

/**
 * Ejecuta las consultas de un proyecto para "Resultados de consultas" y devuelve los documentos agrupados en
 * carpetas, como /portalUpApp/api/documents/queryContent de la consulta general (DocumentTree).
 *
 * Cuerpo (POST): { queries: [ { name, cesql, config } ] }, con cesql ya con los comodines reemplazados
 * (QuerySerializer.fillParameters) y config la ruta de agrupación de la asociación ({ vnRoot: "A,B,C" }). Las consultas
 * corren en el repositorio configurado para el plug-in con la sesión de P8 del usuario, así que solo encuentran lo que
 * él puede ver; solo se aceptan SELECT.
 *
 * Respuesta, siempre HTTP 200: { ok: true, data: { tree, failures: [ { name, message } ], truncated: [ name ] } } o
 * { ok: false, error: { status, code, message } }. Una consulta que falla no impide mostrar las demás. (failures y no
 * errors: ICN muestra su propio diálogo si la respuesta trae errors.)
 */
public class ExecuteQueriesService extends PluginService {

	/** Máximo de consultas por ejecución y de documentos por consulta (el árbol se arma en el navegador). */
	static final int MAX_QUERIES = 50;
	static final int MAX_RESULTS = 1000;
	private static final int PAGE_SIZE = 200;

	/** Ejecuta un CE SQL; interfaz para poder probar handle sin ICN ni P8. */
	interface Executor {
		/** Documentos del CE SQL (id y propiedades de DocumentTree.LABEL_PROPERTIES), hasta max. */
		List<Map<String, Object>> run(String cesql, int max) throws Exception;
	}

	public String getId() {
		return "ExecuteQueriesService";
	}

	public void execute(PluginServiceCallbacks callbacks, HttpServletRequest request, HttpServletResponse response)
			throws Exception {
		PluginLogger logger = callbacks.getLogger();
		JSONObject result;
		try {
			String repositoryId = PluginConfiguration.get(PluginConfiguration.parse(callbacks.loadConfiguration()),
					PluginConfiguration.REPOSITORY_ID);
			result = handle(readBody(request), repositoryId, repositoryId.length() == 0 ? null : p8Executor(callbacks, repositoryId));
		} catch (Throwable t) {
			// También errores de la JVM, que catch (Exception) no atrapa (ver SettingsService).
			logger.logError(this, "execute", "Error al ejecutar las consultas", t);
			result = failure(500, "INTERNAL_ERROR",
					"Error inesperado al ejecutar las consultas (" + t.getClass().getName() + ": " + t.getMessage() + ").");
		}
		response.setContentType("application/json");
		response.setCharacterEncoding("UTF-8");
		PrintWriter writer = response.getWriter();
		try {
			writer.print(result.toString());
			writer.flush();
		} finally {
			writer.close();
		}
	}

	/** Lógica del servicio, separada de PluginServiceCallbacks para poder probarla. executor es null sin repositorio. */
	JSONObject handle(String body, String repositoryId, Executor executor) {
		if (executor == null) {
			return failure(400, "REPOSITORY_NOT_CONFIGURED", "El plug-in no tiene configurado el repositorio de las consultas.");
		}
		JSONArray queries;
		try {
			queries = (JSONArray) JSONObject.parse(body == null ? "" : body).get("queries");
		} catch (Exception e) {
			return failure(400, "INVALID_REQUEST", "La solicitud no es válida: " + e.getMessage());
		}
		if (queries == null || queries.isEmpty()) {
			return failure(400, "INVALID_REQUEST", "La solicitud no trae consultas.");
		}
		if (queries.size() > MAX_QUERIES) {
			return failure(400, "TOO_MANY_QUERIES", "Se admiten hasta " + MAX_QUERIES + " consultas por ejecución.");
		}

		List<DocumentTree.Result> results = new ArrayList<DocumentTree.Result>();
		JSONArray failures = new JSONArray();
		JSONArray truncated = new JSONArray();
		for (Object item : queries) {
			JSONObject query = (JSONObject) item;
			String name = string(query.get("name"));
			String cesql = string(query.get("cesql")).trim();
			if (!cesql.regionMatches(true, 0, "SELECT", 0, 6)) {
				failures.add(queryFailure(name, "La consulta no es un SELECT de CE SQL."));
				continue;
			}
			List<String> path = DocumentTree.parseConfig(string(query.get("config")));
			try {
				List<Map<String, Object>> documents = executor.run(cesql, MAX_RESULTS + 1);
				if (documents.size() > MAX_RESULTS) {
					documents = documents.subList(0, MAX_RESULTS);
					truncated.add(name);
				}
				for (Map<String, Object> document : documents) {
					results.add(new DocumentTree.Result(repositoryId, string(document.get("Id")), path, document));
				}
			} catch (Exception e) {
				failures.add(queryFailure(name, e.getMessage()));
			}
		}

		JSONObject data = new JSONObject();
		data.put("tree", DocumentTree.build(results));
		data.put("failures", failures);
		data.put("truncated", truncated);
		JSONObject result = new JSONObject();
		result.put("ok", Boolean.TRUE);
		result.put("data", data);
		return result;
	}

	/** Ejecuta en el object store del repositorio con la sesión de P8 del usuario conectado a ICN. */
	private static Executor p8Executor(final PluginServiceCallbacks callbacks, final String repositoryId) {
		return new Executor() {
			public List<Map<String, Object>> run(String cesql, int max) {
				Subject subject = callbacks.getP8Subject(repositoryId);
				ObjectStore objectStore = callbacks.getP8ObjectStore(repositoryId);
				if (subject == null || objectStore == null) {
					throw new IllegalStateException("El usuario no tiene sesión en el repositorio " + repositoryId + ".");
				}
				// Las propiedades del rótulo además de las del SELECT (Id, DocumentTitle); las que la clase no tiene no
				// vienen, sin error (agregarlas al SELECT, como hace la consulta general, falla en esas clases).
				StringBuilder names = new StringBuilder("Id");
				for (String name : DocumentTree.LABEL_PROPERTIES) {
					names.append(' ').append(name);
				}
				PropertyFilter filter = new PropertyFilter();
				filter.addIncludeProperty(new FilterElement(null, null, null, names.toString(), null));

				UserContext userContext = UserContext.get();
				userContext.pushSubject(subject);
				try {
					IndependentObjectSet objects = new SearchScope(objectStore).fetchObjects(new SearchSQL(cesql),
							Integer.valueOf(PAGE_SIZE), filter, Boolean.TRUE);
					List<Map<String, Object>> documents = new ArrayList<Map<String, Object>>();
					Iterator<?> iterator = objects.iterator();
					while (iterator.hasNext() && documents.size() < max) {
						Object object = iterator.next();
						if (object instanceof Document) {
							documents.add(properties((Document) object));
						}
					}
					return documents;
				} finally {
					userContext.popSubject();
				}
			}
		};
	}

	private static Map<String, Object> properties(Document document) {
		Map<String, Object> values = new HashMap<String, Object>();
		values.put("Id", document.get_Id().toString());
		Properties properties = document.getProperties();
		for (String name : DocumentTree.LABEL_PROPERTIES) {
			if (properties.isPropertyPresent(name)) {
				values.put(name, properties.getObjectValue(name));
			}
		}
		return values;
	}

	/**
	 * Cuerpo del POST de ecm.model.Request.postPluginService. ICN puede haberlo leído antes (atributo o parámetro
	 * json_post); si no, se lee del request.
	 */
	private static String readBody(HttpServletRequest request) throws IOException {
		Object posted = request.getAttribute("json_post");
		if (posted == null) {
			posted = request.getParameter("json_post");
		}
		if (posted != null) {
			return posted.toString();
		}
		StringBuilder body = new StringBuilder();
		BufferedReader reader = request.getReader();
		char[] buffer = new char[4096];
		int read;
		while ((read = reader.read(buffer)) != -1) {
			body.append(buffer, 0, read);
		}
		return body.toString();
	}

	private static String string(Object value) {
		return value == null ? "" : value.toString();
	}

	private static JSONObject queryFailure(String name, String message) {
		JSONObject failure = new JSONObject();
		failure.put("name", name);
		failure.put("message", message);
		return failure;
	}

	private static JSONObject failure(int status, String code, String message) {
		JSONObject error = new JSONObject();
		error.put("status", (long) status);
		error.put("code", code);
		error.put("message", message);
		JSONObject result = new JSONObject();
		result.put("ok", Boolean.FALSE);
		result.put("error", error);
		return result;
	}
}
