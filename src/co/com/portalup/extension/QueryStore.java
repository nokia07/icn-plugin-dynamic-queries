package co.com.portalup.extension;

import com.ibm.json.java.JSONArray;
import com.ibm.json.java.JSONObject;

/**
 * Almacenamiento de consultas y categorías. Las operaciones y los objetos JSON siguen el contrato
 * docs/api/dynamic-queries.openapi.yaml; user es el usuario de ICN en cuyo nombre se actúa (auditoría).
 */
public interface QueryStore {

	/** Categorías ordenadas por nombre. */
	JSONArray listCategories(String user) throws QueryStoreException;

	/** input: CategoryInput { name, description }. */
	JSONObject createCategory(String user, JSONObject input) throws QueryStoreException;

	/** Página de QuerySummary. categoryId y name son filtros opcionales; sort es "name" o "recent". */
	JSONObject listQueries(String user, String categoryId, String name, String sort, int limit, int offset)
			throws QueryStoreException;

	JSONObject getQuery(String user, String queryId) throws QueryStoreException;

	/** input: QueryInput { name, description, categoryId, definition }. */
	JSONObject createQuery(String user, JSONObject input) throws QueryStoreException;

	/** input: QueryInput más la version leída, para detectar ediciones concurrentes. */
	JSONObject updateQuery(String user, String queryId, JSONObject input) throws QueryStoreException;

	void deleteQuery(String user, String queryId) throws QueryStoreException;
}
