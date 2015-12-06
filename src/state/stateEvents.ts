/// <reference path='../../typings/angularjs/angular.d.ts' />

import {IServiceProviderFactory} from "angular";
import {extend, applyPairs, isFunction} from "../common/common";

import {IStateService, IStateProvider} from "./interface";
import {StateParams} from "./state";
import TargetState from "./targetState";

import {Transition} from "../transition/transition";
import $transitions from "../transition/transitionService";
import {RejectType} from "../transition/rejectFactory";

stateChangeStartHandler.$inject = ['$transition$', '$stateEvents', '$rootScope', '$urlRouter'];
function stateChangeStartHandler($transition$: Transition, $stateEvents, $rootScope, $urlRouter) {
  if (!$transition$.options().notify)
    return;

  let enabledEvents = $stateEvents.provider.enabled();

  /**
   * @ngdoc event
   * @name ui.router.state.$state#$stateChangeStart
   * @eventOf ui.router.state.$state
   * @eventType broadcast on root scope
   * @description
   * Fired when the state transition **begins**. You can use `event.preventDefault()`
   * to prevent the transition from happening and then the transition promise will be
   * rejected with a `'transition prevented'` value.
   *
   * @param {Object} event Event object.
   * @param {Transition} Transition An object containing all contextual information about
   * the current transition, including to and from states and parameters.
   *
   * @example
   *
   * <pre>
   * $rootScope.$on('$stateChangeStart', function(event, transition) {
   *   event.preventDefault();
   *   // transitionTo() promise will be rejected with
   *   // a 'transition prevented' error
   * })
   * </pre>
   */

  let toParams = $transition$.params("to");
  let fromParams = $transition$.params("from");

  if (enabledEvents.$stateChangeStart && $rootScope.$broadcast('$stateChangeStart', $transition$.to(), toParams, $transition$.from(), fromParams, $transition$).defaultPrevented) {
    if (enabledEvents.$stateChangeCancel) {
      $rootScope.$broadcast('$stateChangeCancel', $transition$.to(), toParams, $transition$.from(), fromParams, $transition$);
    }
    $urlRouter.update();
    return false;
  }

  if (enabledEvents.$stateChangeSuccess) {
    $transition$.promise.then(function () {
      /**
       * @ngdoc event
       * @name ui.router.state.$state#$stateChangeSuccess
       * @eventOf ui.router.state.$state
       * @eventType broadcast on root scope
       * @description
       * Fired once the state transition is **complete**.
       *
       * @param {Object} event Event object.
       * @param to
       * @param toParams
       * @param from
       * @param fromParams
       */
      $rootScope.$broadcast('$stateChangeSuccess',
                            //TODO: fix the params
                            $transition$.to(),
                            extend(new StateParams(), toParams).$raw(),
                            $transition$.from(),
                            extend(new StateParams(), fromParams).$raw());
    });
  }

  if (enabledEvents.$stateChangeError) {
    $transition$.promise["catch"](function (error) {
      if (error && (error.type === RejectType.SUPERSEDED || error.type === RejectType.ABORTED))
        return;

      /**
       * @ngdoc event
       * @name ui.router.state.$state#$stateChangeError
       * @eventOf ui.router.state.$state
       * @eventType broadcast on root scope
       * @description
       * Fired when an **error occurs** during transition. It's important to note that if you
       * have any errors in your resolve functions (javascript errors, non-existent services, etc)
       * they will not throw traditionally. You must listen for this $stateChangeError event to
       * catch **ALL** errors.
       *
       * @param {Object} event Event object.
       * @param {State} toState The state being transitioned to.
       * @param {Object} toParams The params supplied to the `toState`.
       * @param {State} fromState The current state, pre-transition.
       * @param {Object} fromParams The params supplied to the `fromState`.
       * @param {Error} error The resolve error object.
       */
      let evt = $rootScope.$broadcast('$stateChangeError',
                                      $transition$.to(),
                                      extend(new StateParams(), toParams).$raw(),
                                      $transition$.from(),
                                      extend(new StateParams(), fromParams).$raw(), error);

      if (!evt.defaultPrevented) {
        $urlRouter.update();
      }
    });
  }
}

stateNotFoundHandler.$inject = ['$to$', '$from$', '$state', '$rootScope', '$urlRouter'];
export function stateNotFoundHandler($to$: TargetState, $from$: TargetState, $state: IStateService, $rootScope, $urlRouter) {
  /**
   * @ngdoc event
   * @name ui.router.state.$state#$stateNotFound
   * @eventOf ui.router.state.$state
   * @eventType broadcast on root scope
   * @description
   * Fired when a requested state **cannot be found** using the provided state name during transition.
   * The event is broadcast allowing any handlers a single chance to deal with the error (usually by
   * lazy-loading the unfound state). A `TargetState` object is passed to the listener handler,
   * you can see its properties in the example. You can use `event.preventDefault()` to abort the
   * transition and the promise returned from `transitionTo()` will be rejected with a
   * `'transition aborted'` error.
   *
   * @param {Object} event Event object.
   * @param {Object} unfoundState Unfound State information. Contains: `to, toParams, options` properties.
   * @param {State} fromState Current state object.
   * @param {Object} fromParams Current state params.
   * @example
   *
   * <pre>
   * // somewhere, assume lazy.state has not been defined
   * $state.go("lazy.state", { a: 1, b: 2 }, { inherit: false });
   *
   * // somewhere else
   * $scope.$on('$stateNotFound', function(event, transition) {
   * function(event, unfoundState, fromState, fromParams){
   *     console.log(unfoundState.to); // "lazy.state"
   *     console.log(unfoundState.toParams); // {a:1, b:2}
   *     console.log(unfoundState.options); // {inherit:false} + default options
   * });
   * </pre>
   */
  let redirect = { to: $to$.identifier(), toParams: $to$.params(), options: $to$.options() };
  let e = $rootScope.$broadcast('$stateNotFound', redirect, $from$.state(), $from$.params());

  if (e.defaultPrevented || e.retry)
    $urlRouter.update();

  function redirectFn(): TargetState {
    return $state.targetState(redirect.to, redirect.toParams, redirect.options);
  }

  if (e.defaultPrevented) {
    return false;
  } else if (e.retry || $state.get(redirect.to)) {
    return e.retry && isFunction(e.retry.then) ? e.retry.then(redirectFn) : redirectFn();
  }
}

$StateEventsProvider.$inject = ['$stateProvider'];
function $StateEventsProvider($stateProvider: IStateProvider) {
  $StateEventsProvider.prototype.instance = this;

  interface IEventsToggle {
    $stateChangeStart: boolean;
    $stateNotFound: boolean;
    $stateChangeSuccess: boolean;
    $stateChangeError: boolean;
  }

  let runtime = false;
  let allEvents = [ '$stateChangeStart', '$stateNotFound', '$stateChangeSuccess', '$stateChangeError' ];
  let enabledStateEvents: IEventsToggle = <IEventsToggle> allEvents.map(e => [e, false]).reduce(applyPairs, {});

  function assertNotRuntime() {
    if (runtime) throw new Error("Cannot enable events at runtime (use $stateEventsProvider");
  }

  /**
   * Enables the deprecated UI-Router 0.2.x State Events
   * [ '$stateChangeStart', '$stateNotFound', '$stateChangeSuccess', '$stateChangeError' ]
   */
  this.enable = function(...events: string[]) {
    assertNotRuntime();
    if (!events || !events.length) events = allEvents;
    events.forEach(event => enabledStateEvents[event] = true);
  };

  /**
   * Disables the deprecated UI-Router 0.2.x State Events
   * [ '$stateChangeStart', '$stateNotFound', '$stateChangeSuccess', '$stateChangeError' ]
   */
  this.disable = function(...events: string[]) {
    assertNotRuntime();
    if (!events || !events.length) events = allEvents;
    events.forEach(event => delete enabledStateEvents[event]);
  };

  this.enabled = () => enabledStateEvents;

  this.$get = function() {
    runtime = true;

    if (enabledStateEvents["$stateNotFound"])
      $stateProvider.onInvalid(stateNotFoundHandler);
    if (enabledStateEvents.$stateChangeStart)
      $transitions.onBefore({}, stateChangeStartHandler, { priority: 1000 });

    return {
      provider: $StateEventsProvider.prototype.instance
    };
  };
}



angular.module('ui.router.state.events', ['ui.router.state'])
  .provider("$stateEvents", <IServiceProviderFactory> $StateEventsProvider)
  .run([ '$stateEvents', function($stateEvents) { /* Invokes $get() */ }]);