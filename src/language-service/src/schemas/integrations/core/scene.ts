/**
 * Scene integration
 * Source: https://github.com/home-assistant/core/blob/dev/homeassistant/components/scene/__init__.py
 */
import { IncludeNamed, IncludeList, Deprecated, State } from "../../types";

export type Domain = "scene";
export type Schema = Item[] | IncludeList;
export type File = Item | Item[];

interface Item {
  /**
   * Entities to control and their desired state.
   * https://www.home-assistant.io/integrations/scene#entities
   */
  entities:
    | {
      [entity: string]: ItemEntity | State;
    }
    | IncludeNamed;

  /**
   * The icon that shows in the frontend.
   * https://www.home-assistant.io/integrations/scene#icon
   */
  icon?: string;

  /**
   * A unique identifier for this automation.
   * Do not use the same twice, ever!
   * https://www.home-assistant.io/integrations/scene
   */
  id?: string;

  /**
   * Friendly name of scene.
   * https://www.home-assistant.io/integrations/scene#name
   */
  name: string;

  /**
   * Additional data for merely for use with the frontend. Has no functional effect.
   */
  metadata?: any;
}

/**
 * @TJS-additionalProperties true
 */
export interface ItemEntity {
  // Attributes can be null: scenes saved by HA store attributes that don't
  // apply to the current colour mode as empty values
  state?: string | null;
  /**
   * @TSJ-type integer
   * @minimum 0
   * @maximum 255
   */
  brightness?: number | string | null;
  source?: string | null;
  /**
   * @minimum 1
   */
  color_temp?: number | string | null;
  xy_color?: any;

  /**
   * DEPRECATED.
   *
   * Using transitions on scene using this property is no longer supported.
   * Alternative: https://www.home-assistant.io/docs/scene/#using-scene-transitions
   */
  transition?: Deprecated;
}
