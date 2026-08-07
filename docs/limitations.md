# Limitations and non-goals

The system is not a network standard, not a universal exactly-once layer, not an operator-required profile and not a substitute for business-domain authorization. The reference receiver uses SQLite for reproducible integration testing and local operation; high-volume production deployments should implement the same transaction and fencing contract on a managed relational database. Commercial demand remains unvalidated.
