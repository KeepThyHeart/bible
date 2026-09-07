/**
 * Base interface for all repository implementations.
 *
 * Repositories provide a clean API for CRUD operations on specific entities,
 * abstracting away the underlying SQL implementation.
 *
 * Each repository requires an ISql provider to be injected via the constructor,
 * following the Dependency Injection pattern.
 *
 * Example implementation:
 * ```typescript
 * class UserRepository implements IRepository<User> {
 *   constructor(private sql: ISql) {}
 *
 *   getById(id: number): User | undefined {
 *     return this.sql.queryOne<User>('SELECT * FROM users WHERE id = ?', [id]);
 *   }
 *
 *   // ... other methods
 * }
 * ```
 */
export interface IRepository<T> {
  /**
   * Retrieve an entity by its ID
   * @param id Primary key of the entity
   * @returns The entity, or undefined if not found
   */
  getById(id: number): T | undefined;

  /**
   * Create a new entity
   * @param entity Entity to create
   * @returns The created entity with ID populated
   */
  create(entity: T): T;

  /**
   * Update an existing entity
   * @param entity Entity with updated values
   * @returns The updated entity
   */
  update(entity: T): T;

  /**
   * Delete an entity by ID
   * @param id Primary key of the entity to delete
   * @returns True if deleted, false if not found
   */
  delete(id: number): boolean;

  /**
   * Get all entities
   * @param options Optional query options (limit, offset, ordering)
   * @returns Array of all entities
   */
  getAll(options?: RepositoryQueryOptions): T[];
}

/**
 * Query options for repository methods
 */
export interface RepositoryQueryOptions {
  /** Maximum number of results to return */
  limit?: number;
  /** Number of results to skip (for pagination) */
  offset?: number;
  /** Field to order by */
  orderBy?: string;
  /** Sort direction */
  orderDirection?: 'ASC' | 'DESC';
}
