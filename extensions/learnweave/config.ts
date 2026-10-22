/** Shared by tools and routes; importing this never loads generation or persistence. */
export const learnweaveEnabled = () => process.env.LEARNWEAVE_EXTENSION_ENABLED === 'true';
