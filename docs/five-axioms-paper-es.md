# Los Cinco Axiomas de la Distribución Justa de Recompensas: Un Marco de Equidad Demostrable para las Finanzas Descentralizadas (Traducción al español)

**Faraday1 (Will Glynn) & JARVIS**

*VibeSwap Protocol -- vibeswap.org*

*Marzo 2026*

---

## Resumen

Presentamos cinco axiomas que en conjunto definen la distribución *demostráblemente justa* de recompensas en sistemas cooperativos descentralizados. Los primeros cuatro axiomas —Eficiencia, Simetría, Jugador Nulo y Proporcionalidad por Pares— derivan de la teoría clásica de juegos cooperativos y del valor de Shapley. El quinto, la **Neutralidad Temporal**, es un axioma novedoso que elimina el sesgo temporal de la distribución de comisiones: contribuciones idénticas en diferentes épocas deben generar recompensas idénticas. Demostramos que una asignación Shapley proporcional ponderada satisface simultáneamente los cinco axiomas, proporcionamos métodos de verificación en cadena para cada uno y presentamos una implementación funcional en Solidity. El marco resuelve una tensión fundamental en la economía de tokens: cómo recompensar las contribuciones fundacionales ("de nivel cueva") sin introducir la extracción de renta basada en el tiempo que aqueja a los protocolos existentes. Demostramos que el valor de Shapley *naturalmente* asigna mayores recompensas a los trabajos de mayor impacto mediante el análisis de contribución marginal, haciendo que las bonificaciones para los primeros participantes sean matemáticamente innecesarias.

**Palabras clave**: valor de Shapley, teoría de juegos cooperativos, axiomas de equidad, DeFi, economía de tokens, neutralidad temporal, MEV

---

