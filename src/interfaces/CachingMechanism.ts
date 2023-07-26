import { Struct } from "superstruct";

/**
 * The interface for a caching mechanism. This is used to store and retrieve values from a cache.
 * @interface CachingInterface
 * @exports
 */
export interface CachingMechanismInterface {
  /**
   * Attempts to retrieve a value from the cache.
   * @param key The key to retrieve.
   * @returns The value if it exists, otherwise null.
   */
  get<ObjectType, OverrideType>(
    key?: string,
    structValidator?: Struct<unknown, unknown>,
    overrides?: OverrideType
  ): Promise<ObjectType | null>;

  /**
   * Attempts to store a value in the cache.
   * @param key The key to store.
   * @param value The value to store.
   * @param ttl The time to live in seconds.
   * @param overrides Any overrides to the default caching mechanism configuration for the given caching protocol.
   * @returns True if the value was stored, otherwise false.
   * @throws {Error} If the value could not be stored.
   */
  set<ObjectType, OverrideType>(
    key: string,
    value: ObjectType,
    ttl?: number,
    overrides?: OverrideType
  ): Promise<boolean>;

  /**
   * Identical to set, but returns the ID of the value stored. This is useful for storing values in a cache that
   * are not known ahead of time. For example, if you want to store a value in a cache that is the result of a
   * computation, you can use this method to store the value and retrieve the ID of the value stored.
   * @param key The canonical key to store.
   * @param value The value to store.
   * @param ttl The time to live in seconds.
   * @param overrides Any overrides to the default caching mechanism configuration for the given caching protocol.
   */
  setWithReturnID<ObjectType, OverrideType>(
    key: string,
    value: ObjectType,
    ttl?: number,
    overrides?: OverrideType
  ): Promise<string | undefined>;
}
