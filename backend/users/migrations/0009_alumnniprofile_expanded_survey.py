# Generated migration for AlumniProfile expanded survey fields

from django.db import migrations, models
from django.core.validators import MinValueValidator, MaxValueValidator


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0008_alter_alumniaccount_biometric_template'),
    ]

    operations = [
        migrations.AddField(
            model_name='alumnniprofile',
            name='academic_honors',
            field=models.IntegerField(
                blank=True,
                choices=[(1, 'None'), (2, 'Cum Laude'), (3, 'Magna Cum Laude'), (4, 'Summa Cum Laude')],
                help_text='Academic honors for regression model',
                null=True
            ),
        ),
        migrations.AddField(
            model_name='alumnniprofile',
            name='english_proficiency',
            field=models.IntegerField(
                blank=True,
                choices=[(1, 'Basic'), (2, 'Conversational'), (3, 'Professional/Business')],
                help_text='English proficiency level',
                null=True
            ),
        ),
        migrations.AddField(
            model_name='alumnniprofile',
            name='general_average_range',
            field=models.IntegerField(
                blank=True,
                choices=[(0, 'Below 75'), (1, '75-79'), (2, '80-84'), (3, '85-89'), (4, '90-94'), (5, '95-100')],
                help_text='GPA range encoding for regression model',
                null=True
            ),
        ),
        migrations.AddField(
            model_name='alumnniprofile',
            name='has_portfolio',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='alumnniprofile',
            name='ojt_relevance',
            field=models.IntegerField(
                blank=True,
                choices=[(0, 'Not applicable'), (1, 'Not related'), (2, 'Somewhat related'), (3, 'Yes, directly related')],
                help_text='OJT relevance to BSIS degree',
                null=True
            ),
        ),
        migrations.AddField(
            model_name='alumnniprofile',
            name='prior_work_experience',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='alumnniprofile',
            name='professional_certifications',
            field=models.JSONField(
                blank=True,
                default=list,
                help_text='Array of professional certification strings'
            ),
        ),
        migrations.AddField(
            model_name='alumnniprofile',
            name='soft_skill_count',
            field=models.IntegerField(
                default=0,
                help_text='Count of soft skills selected (0-10)',
                validators=[
                    MinValueValidator(0),
                    MaxValueValidator(10)
                ]
            ),
        ),
        migrations.AddField(
            model_name='alumnniprofile',
            name='technical_skill_count',
            field=models.IntegerField(
                default=0,
                help_text='Count of technical skills selected (0-12)',
                validators=[
                    MinValueValidator(0),
                    MaxValueValidator(12)
                ]
            ),
        ),
    ]
