package co.com.portalup.extension;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import com.ibm.json.java.JSONArray;
import com.ibm.json.java.JSONObject;

/**
 * Modo simulado: guarda categorías y consultas en memoria del servidor de ICN mientras no exista la API externa.
 * Aplica las mismas reglas que el contrato (validaciones, 404, 409, versión, auditoría) para que el cliente se
 * comporte igual que con la API real. Los datos son compartidos por todos los usuarios y se pierden al reiniciar.
 */
public class InMemoryQueryStore implements QueryStore {

	public static final InMemoryQueryStore INSTANCE = new InMemoryQueryStore();

	private static final int MAX_CATEGORY_NAME = 120;
	private static final int MAX_QUERY_NAME = 200;

	private final Map<String, JSONObject> categories = new LinkedHashMap<String, JSONObject>();
	private final Map<String, JSONObject> queries = new LinkedHashMap<String, JSONObject>();

	private InMemoryQueryStore() {
	}

	public synchronized JSONArray listCategories(String user) {
		List<JSONObject> sorted = new ArrayList<JSONObject>();
		for (JSONObject category : categories.values()) {
			JSONObject copy = copy(category);
			copy.put("queryCount", countQueries((String) category.get("id")));
			sorted.add(copy);
		}
		Collections.sort(sorted, byString("name"));
		JSONArray result = new JSONArray();
		result.addAll(sorted);
		return result;
	}

	public synchronized JSONObject createCategory(String user, JSONObject input) throws QueryStoreException {
		String name = requiredText(input, "name", MAX_CATEGORY_NAME, "El nombre de la categoría");
		for (JSONObject existing : categories.values()) {
			if (normalize((String) existing.get("name")).equals(normalize(name))) {
				throw new QueryStoreException(409, "CATEGORY_EXISTS", "Ya existe una categoría llamada “" + name + "”.");
			}
		}
		JSONObject category = new JSONObject();
		category.put("id", UUID.randomUUID().toString());
		category.put("name", name);
		category.put("description", optionalText(input, "description"));
		stampCreated(category, user);
		categories.put((String) category.get("id"), category);

		JSONObject result = copy(category);
		result.put("queryCount", 0L);
		return result;
	}

	public synchronized JSONObject listQueries(String user, String categoryId, String name, String sort, int limit,
			int offset) {
		String needle = name == null ? "" : normalize(name);
		List<JSONObject> matches = new ArrayList<JSONObject>();
		for (JSONObject query : queries.values()) {
			if (categoryId != null && !categoryId.equals(query.get("categoryId"))) {
				continue;
			}
			if (needle.length() > 0 && normalize((String) query.get("name")).indexOf(needle) < 0) {
				continue;
			}
			matches.add(query);
		}
		if ("recent".equals(sort)) {
			Collections.sort(matches, Collections.reverseOrder(byString("updatedAt")));
		} else {
			Collections.sort(matches, byString("name"));
		}

		JSONArray items = new JSONArray();
		for (int i = offset; i < matches.size() && i < offset + limit; i++) {
			items.add(summary(matches.get(i)));
		}
		JSONObject page = new JSONObject();
		page.put("items", items);
		page.put("total", (long) matches.size());
		page.put("limit", (long) limit);
		page.put("offset", (long) offset);
		return page;
	}

	public synchronized JSONObject getQuery(String user, String queryId) throws QueryStoreException {
		return copy(findQuery(queryId));
	}

	public synchronized JSONObject createQuery(String user, JSONObject input) throws QueryStoreException {
		JSONObject query = new JSONObject();
		query.put("id", UUID.randomUUID().toString());
		applyQueryInput(query, input);
		query.put("version", 1L);
		stampCreated(query, user);
		queries.put((String) query.get("id"), query);
		return copy(query);
	}

	public synchronized JSONObject updateQuery(String user, String queryId, JSONObject input)
			throws QueryStoreException {
		JSONObject query = findQuery(queryId);
		Object version = input.get("version");
		if (!(version instanceof Number) || ((Number) version).longValue() != ((Number) query.get("version")).longValue()) {
			throw new QueryStoreException(409, "VERSION_CONFLICT",
					"Otro usuario modificó la consulta después de que usted la abrió. Vuelva a abrirla antes de guardar.");
		}
		applyQueryInput(query, input);
		query.put("version", ((Number) query.get("version")).longValue() + 1);
		query.put("updatedBy", user);
		query.put("updatedAt", now());
		return copy(query);
	}

	public synchronized void deleteQuery(String user, String queryId) throws QueryStoreException {
		findQuery(queryId);
		queries.remove(queryId);
	}

	private void applyQueryInput(JSONObject query, JSONObject input) throws QueryStoreException {
		String name = requiredText(input, "name", MAX_QUERY_NAME, "El nombre de la consulta");
		String categoryId = requiredText(input, "categoryId", Integer.MAX_VALUE, "La categoría");
		if (!categories.containsKey(categoryId)) {
			throw new QueryStoreException(404, "CATEGORY_NOT_FOUND", "La categoría seleccionada ya no existe.");
		}
		Object definition = input.get("definition");
		if (!(definition instanceof JSONObject)) {
			throw new QueryStoreException(400, "VALIDATION_ERROR", "Falta la definición de la consulta.");
		}
		query.put("name", name);
		query.put("description", optionalText(input, "description"));
		query.put("categoryId", categoryId);
		query.put("definition", definition);
	}

	private JSONObject findQuery(String queryId) throws QueryStoreException {
		JSONObject query = queryId == null ? null : queries.get(queryId);
		if (query == null) {
			throw new QueryStoreException(404, "QUERY_NOT_FOUND", "La consulta no existe o fue eliminada.");
		}
		return query;
	}

	private long countQueries(String categoryId) {
		long count = 0;
		for (JSONObject query : queries.values()) {
			if (categoryId.equals(query.get("categoryId"))) {
				count++;
			}
		}
		return count;
	}

	private static JSONObject summary(JSONObject query) {
		JSONObject summary = new JSONObject();
		for (String key : new String[] { "id", "name", "description", "categoryId", "createdBy", "createdAt",
				"updatedBy", "updatedAt" }) {
			summary.put(key, query.get(key));
		}
		JSONObject documentClass = (JSONObject) ((JSONObject) query.get("definition")).get("documentClass");
		if (documentClass != null) {
			summary.put("documentClass", documentClass.get("symbolicName"));
		}
		return summary;
	}

	private static void stampCreated(JSONObject object, String user) {
		String now = now();
		object.put("createdBy", user);
		object.put("createdAt", now);
		object.put("updatedBy", user);
		object.put("updatedAt", now);
	}

	private static String now() {
		return java.time.Instant.now().toString();
	}

	private static String requiredText(JSONObject input, String field, int maxLength, String label)
			throws QueryStoreException {
		Object value = input.get(field);
		String text = value instanceof String ? ((String) value).trim() : "";
		if (text.length() == 0) {
			throw new QueryStoreException(400, "VALIDATION_ERROR", label + " es obligatorio.");
		}
		if (text.length() > maxLength) {
			throw new QueryStoreException(400, "VALIDATION_ERROR", label + " admite como máximo " + maxLength + " caracteres.");
		}
		return text;
	}

	private static String optionalText(JSONObject input, String field) {
		Object value = input.get(field);
		return value instanceof String ? ((String) value).trim() : "";
	}

	/** Minúsculas y sin tildes, para comparar nombres. */
	private static String normalize(String text) {
		return Normalizer.normalize(text, Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT);
	}

	private static Comparator<JSONObject> byString(final String field) {
		return new Comparator<JSONObject>() {
			public int compare(JSONObject a, JSONObject b) {
				return normalize(String.valueOf(a.get(field))).compareTo(normalize(String.valueOf(b.get(field))));
			}
		};
	}

	/** Copia superficial: suficiente porque las actualizaciones reemplazan valores, no modifican los guardados. */
	private static JSONObject copy(JSONObject object) {
		JSONObject copy = new JSONObject();
		copy.putAll(object);
		return copy;
	}
}
