import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import '@fontsource-variable/hanken-grotesk';
// The width axis too, as the landing page and console load it, so mono labels can be set narrower.
import '@fontsource-variable/martian-mono/standard.css';
import './style.css';
import './diagrams.css';
import ProductLoop from './components/ProductLoop.vue';
import HowItWorksFlow from './components/HowItWorksFlow.vue';
import YieldShapes from './components/YieldShapes.vue';
import CreditsFlow from './components/CreditsFlow.vue';
import PrivacyModes from './components/PrivacyModes.vue';
import IntentsRoutes from './components/IntentsRoutes.vue';
import GatewaySteps from './components/GatewaySteps.vue';
import FreeCallPips from './components/FreeCallPips.vue';

// The stock reading layout (sidebar, outline, search, prev and next), in InferNear's colours and
// type, with the diagrams available to every page as one tag each.
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ProductLoop', ProductLoop);
    app.component('HowItWorksFlow', HowItWorksFlow);
    app.component('YieldShapes', YieldShapes);
    app.component('CreditsFlow', CreditsFlow);
    app.component('PrivacyModes', PrivacyModes);
    app.component('IntentsRoutes', IntentsRoutes);
    app.component('GatewaySteps', GatewaySteps);
    app.component('FreeCallPips', FreeCallPips);
  },
} satisfies Theme;
