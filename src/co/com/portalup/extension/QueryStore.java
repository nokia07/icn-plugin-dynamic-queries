package co.com.portalup.extension;

import com.ibm.json.java.JSONObject;

/**
 * Almacenamiento de consultas. Las operaciones y los objetos JSON siguen el contrato
 * docs/api/dynamic-queries.openapi.yaml; user es el usuario de ICN en cuyo nombre se actúa (auditoría).
 */
public interface QueryStore {

	/** Página de QuerySummary. name es un filtro opcional; sort es "name" o "recent". */
	JSONObject listQueries(String user, String name, String sort, int limit, int offset)
			throws QueryStoreException;

	JSONObject getQuery(String user, String queryId) throws QueryStoreException;

	/** input: QueryInput { name, description, definition }. */
	JSONObject createQuery(String user, JSONObject input) throws QueryStoreException;

	/** input: QueryInput más la version leída, para detectar ediciones concurrentes. */
	JSONObject updateQuery(String user, String queryId, JSONObject input) throws QueryStoreException;

	void deleteQuery(String user, String queryId) throws QueryStoreException;
}
