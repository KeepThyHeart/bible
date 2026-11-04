/** The page's annotation store (lazy chunk), wired to the worker. */
import { AnnotationStore } from './annotationStore';
import { getAnnotationsApi } from './annotationApi';

export const annotationStore = new AnnotationStore(getAnnotationsApi);
