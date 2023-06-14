# Generated by Django 4.1.7 on 2023-04-28 14:29

from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Mesi_model",
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
                ("company", models.CharField(max_length=40)),
                ("holding", models.IntegerField()),
                ("total_cost", models.FloatField()),
                ("industry", models.CharField(default="", max_length=40)),
                ("index", models.CharField(default="", max_length=20)),
                ("epic", models.CharField(default="", max_length=10)),
            ],
        ),
    ]
