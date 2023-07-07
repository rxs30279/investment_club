# Generated by Django 4.1.7 on 2023-06-14 14:31

import datetime
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Stock",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("ticker", models.CharField(max_length=20)),
                ("name", models.CharField(max_length=20)),
                ("create_date", models.DateTimeField(auto_now_add=True)),
                (
                    "originalPrice",
                    models.FloatField(blank=True, default=0.0, null=True),
                ),
                (
                    "date_updated",
                    models.DateField(blank=True, default=datetime.datetime.now),
                ),
            ],
        ),
    ]