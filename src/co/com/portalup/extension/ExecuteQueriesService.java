package co.com.portalup.extension;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import javax.security.auth.Subject;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import com.filenet.api.admin.ChoiceList;
import com.filenet.api.collection.IndependentObjectSet;
import com.filenet.api.core.Document;
import com.filenet.api.core.Factory;
import com.filenet.api.core.ObjectStore;
import com.filenet.api.core.RetrievingBatch;
import com.filenet.api.meta.ClassDescription;
import com.filenet.api.meta.PropertyDescription;
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
 * (QuerySerializer.fillParameters) y config la ruta de agrupación de la asociación ({ vnRoot: "A,B,C" }, que puede
 * llevar propiedades del documento como #Nombre#, ver DocumentTree.resolvePath, y el patrón del nombre de los
 * documentos, docLabel, ver DocumentTree.resolveLabel). Las consultas
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
		/**
		 * Documentos del CE SQL (Id y las propiedades indicadas que tenga cada uno; las que tienen lista de opciones,
		 * también con su nombre visible en nombre + DocumentTree.DISPLAY_SUFFIX), hasta max.
		 */
		List<Map<String, Object>> run(String cesql, int max, Collection<String> properties) throws Exception;
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
		write(response, result);
	}

	/** Escribe la respuesta JSON del servicio (también la usa DocumentPropertiesService). */
	static void write(HttpServletResponse response, JSONObject result) throws IOException {
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
			String config = string(query.get("config"));
			List<String> path = DocumentTree.parseConfig(config);
			String labelPattern = DocumentTree.parseLabelPattern(config);
			// Las del rótulo y las de la ruta de agrupación y del patrón del nombre (#Nombre#).
			Set<String> properties = new LinkedHashSet<String>(Arrays.asList(DocumentTree.LABEL_PROPERTIES));
			properties.addAll(DocumentTree.patternProperties(path));
			properties.addAll(DocumentTree.patternProperties(Arrays.asList(labelPattern)));
			try {
				List<Map<String, Object>> documents = executor.run(cesql, MAX_RESULTS + 1, properties);
				if (documents.size() > MAX_RESULTS) {
					documents = documents.subList(0, MAX_RESULTS);
					truncated.add(name);
				}
				for (Map<String, Object> document : documents) {
					results.add(new DocumentTree.Result(repositoryId, string(document.get("Id")),
							DocumentTree.resolvePath(path, document), document, DocumentTree.resolveLabel(labelPattern, document)));
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
			public List<Map<String, Object>> run(String cesql, int max, Collection<String> properties) {
				Subject subject = callbacks.getP8Subject(repositoryId);
				ObjectStore objectStore = callbacks.getP8ObjectStore(repositoryId);
				if (subject == null || objectStore == null) {
					throw new IllegalStateException("El usuario no tiene sesión en el repositorio " + repositoryId + ".");
				}
				// Las propiedades del rótulo y de la ruta además de las del SELECT (Id, DocumentTitle); las que la clase no
				// tiene no vienen, sin error (agregarlas al SELECT, como hace la consulta general, falla en esas clases).
				// fetchObjects ignora este filtro (solo devuelve las del SELECT, verificado en el ambiente de pruebas), así
				// que se piden después con un RetrievingBatch.
				StringBuilder names = new StringBuilder("Id");
				for (String name : properties) {
					names.append(' ').append(name);
				}
				PropertyFilter filter = new PropertyFilter();
				filter.addIncludeProperty(new FilterElement(null, null, null, names.toString(), null));

				UserContext userContext = UserContext.get();
				userContext.pushSubject(subject);
				try {
					IndependentObjectSet objects = new SearchScope(objectStore).fetchObjects(new SearchSQL(cesql),
							Integer.valueOf(PAGE_SIZE), null, Boolean.TRUE);
					List<Document> found = new ArrayList<Document>();
					Iterator<?> iterator = objects.iterator();
					while (iterator.hasNext() && found.size() < max) {
						Object object = iterator.next();
						if (object instanceof Document) {
							found.add((Document) object);
						}
					}
					fetchProperties(objectStore, found, filter);
					List<Map<String, Object>> documents = new ArrayList<Map<String, Object>>();
					Map<String, Map<String, ChoiceList>> choiceLists = new HashMap<String, Map<String, ChoiceList>>();
					for (Document document : found) {
						documents.add(values(document, properties, choiceLists(objectStore, document.getClassName(), choiceLists)));
					}
					return documents;
				} finally {
					userContext.popSubject();
				}
			}
		};
	}

	/**
	 * Trae las propiedades del filtro a los documentos, en lotes de PAGE_SIZE (un viaje a P8 por lote). Un documento
	 * que falla se queda con las del SELECT.
	 */
	private static void fetchProperties(ObjectStore objectStore, List<Document> documents, PropertyFilter filter) {
		for (int start = 0; start < documents.size(); start += PAGE_SIZE) {
			RetrievingBatch batch = RetrievingBatch.createRetrievingBatchInstance(
					Factory.Domain.getInstance(objectStore.getConnection(), null));
			for (Document document : documents.subList(start, Math.min(start + PAGE_SIZE, documents.size()))) {
				batch.add(document, filter);
			}
			batch.retrieveBatch();
		}
	}

	/**
	 * Listas de opciones de las propiedades de una clase (nombre simbólico → lista), una vez por clase en cache. Si no
	 * se puede leer la descripción de la clase, ninguna: los valores se muestran como están guardados.
	 */
	private static Map<String, ChoiceList> choiceLists(ObjectStore objectStore, String className,
			Map<String, Map<String, ChoiceList>> cache) {
		Map<String, ChoiceList> lists = cache.get(className);
		if (lists == null) {
			lists = new HashMap<String, ChoiceList>();
			try {
				ClassDescription description = Factory.ClassDescription.fetchInstance(objectStore, className, null);
				Iterator<?> descriptions = description.get_PropertyDescriptions().iterator();
				while (descriptions.hasNext()) {
					PropertyDescription property = (PropertyDescription) descriptions.next();
					if (property.get_ChoiceList() != null) {
						lists.put(property.get_SymbolicName(), property.get_ChoiceList());
					}
				}
			} catch (RuntimeException e) {
				// Sin nombres visibles para esta clase.
			}
			cache.put(className, lists);
		}
		return lists;
	}

	private static Map<String, Object> values(Document document, Collection<String> names, Map<String, ChoiceList> choiceLists) {
		Map<String, Object> values = new HashMap<String, Object>();
		values.put("Id", document.get_Id().toString());
		Properties properties = document.getProperties();
		for (String name : names) {
			if (properties.isPropertyPresent(name)) {
				Object value = properties.getObjectValue(name);
				values.put(name, value);
				ChoiceList choiceList = choiceLists.get(name);
				if (choiceList != null && value != null) {
					values.put(name + DocumentTree.DISPLAY_SUFFIX, displayValue(value, choiceList));
				}
			}
		}
		return values;
	}

	// Nombre visible de un valor (o de cada valor de una lista) en la lista de opciones; el valor si no está en ella.
	private static Object displayValue(Object value, ChoiceList choiceList) {
		if (value instanceof Collection) {
			List<Object> displayed = new ArrayList<Object>();
			for (Object item : (Collection<?>) value) {
				displayed.add(item == null ? null : displayValue(item, choiceList));
			}
			return displayed;
		}
		String display = DocumentPropertiesService.choiceDisplayName(choiceList.get_ChoiceValues(), value);
		return display != null ? display : value;
	}

	/**
	 * Cuerpo del POST de ecm.model.Request.postPluginService. ICN puede haberlo leído antes (atributo o parámetro
	 * json_post); si no, se lee del request.
	 */
	static String readBody(HttpServletRequest request) throws IOException {
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

	static JSONObject failure(int status, String code, String message) {
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
